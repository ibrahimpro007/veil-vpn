/// Billing entry points, split by build flavor.
///
/// * `direct` (the shipped flavor): web checkout via `POST /v1/billing/checkout`
///   (Stripe / LemonSqueezy), opened in the external browser. Fully working.
/// * `play` / `macstore`: native store billing via `in_app_purchase`
///   (Play Billing / StoreKit). This code is REAL and compiles, but it is
///   INACTIVE unless all of the following are true:
///   1. the app was built with `--dart-define=FLAVOR=play|macstore`,
///   2. products (`veil_monthly`, `veil_yearly`) exist in Play Console /
///      App Store Connect with the same ids,
///   3. the server has verified the purchase via the RTDN / App Store Server
///      Notifications webhook (`POST /v1/webhooks/play|storekit`) and the
///      client refreshed `GET /v1/subscription` afterwards.
///
/// Client-side purchase verification is intentionally NOT done here: the
/// server is the source of truth (webhook + `payment_events` idempotency).
/// After a successful native purchase we simply re-fetch the subscription;
/// the webhook may take a few seconds, so the UI retries with backoff.
library;

import 'dart:async';

import 'package:flutter/widgets.dart';
import 'package:in_app_purchase/in_app_purchase.dart';
import 'package:url_launcher/url_launcher.dart';

import '../core/api_client.dart';
import '../core/config.dart';

/// Product ids — must match Play Console / App Store Connect exactly.
const kStoreProductIds = {'veil_monthly', 'veil_yearly'};

/// Thrown when store billing is invoked on a build where it is inactive.
class StoreBillingInactiveException implements Exception {
  final String flavor;
  const StoreBillingInactiveException(this.flavor);
  @override
  String toString() =>
      'StoreBillingInactiveException: store billing is not active '
      '(FLAVOR=$flavor). Use web checkout instead.';
}

class StoreBilling {
  final VeilApiClient _api;

  StreamSubscription<List<PurchaseDetails>>? _purchaseSub;
  final _purchaseEvents = StreamController<PurchaseDetails>.broadcast();

  /// Purchase results for the UI to observe in store flavors.
  Stream<PurchaseDetails> get purchaseEvents => _purchaseEvents.stream;

  StoreBilling(this._api);

  /// Direct flavor: create a Stripe/LemonSqueezy checkout session and open it
  /// in the external browser.
  Future<void> checkoutOnWeb({
    required String planId,
    required String provider, // 'stripe' | 'lemonsqueezy'
  }) async {
    final url = await _api.createCheckout(planId: planId, provider: provider);
    final ok = await launchUrl(url, mode: LaunchMode.externalApplication);
    if (!ok) {
      throw ApiException(
          code: 'browser_failed',
          message: 'Could not open the checkout page: $url');
    }
  }

  /// Store flavors: buy via Play Billing / StoreKit.
  ///
  /// Real implementation, guarded: throws [StoreBillingInactiveException]
  /// unless the flavor is a store flavor AND store billing was explicitly
  /// activated (see [AppConfig.storeBillingActive]).
  Future<void> buyWithStore(BuildContext context,
      {required String productId}) async {
    if (!AppConfig.isStoreFlavor || !AppConfig.storeBillingActive) {
      throw StoreBillingInactiveException(AppConfig.flavor);
    }
    if (!kStoreProductIds.contains(productId)) {
      throw ArgumentError('Unknown store product: $productId');
    }
    final iap = InAppPurchase.instance;
    final available = await iap.isAvailable();
    if (!available) {
      throw const ApiException(
          code: 'store_unavailable',
          message: 'The app store is not available on this device.');
    }
    _ensurePurchaseListener();
    final response =
        await iap.queryProductDetails({productId});
    if (response.error != null || response.productDetails.isEmpty) {
      throw ApiException(
          code: 'store_product_missing',
          message:
              'Product not found in the store: $productId (${response.error?.message ?? 'unknown error'})');
    }
    final product = response.productDetails.first;
    final purchaseParam = PurchaseParam(productDetails: product);
    // Subscriptions sold as non-consumables here; the server maps the
    // verified purchase to a subscription via the store webhook.
    final launched =
        await iap.buyNonConsumable(purchaseParam: purchaseParam);
    if (!launched) {
      throw const ApiException(
          code: 'store_launch_failed',
          message: 'Could not start the store purchase flow.');
    }
  }

  /// Restores past store purchases (store flavors only).
  Future<void> restorePurchases() async {
    if (!AppConfig.isStoreFlavor || !AppConfig.storeBillingActive) {
      throw StoreBillingInactiveException(AppConfig.flavor);
    }
    _ensurePurchaseListener();
    await InAppPurchase.instance.restorePurchases();
  }

  void _ensurePurchaseListener() {
    _purchaseSub ??= InAppPurchase.instance.purchaseStream.listen(
      (purchases) async {
        for (final purchase in purchases) {
          if (purchase.status == PurchaseStatus.purchased ||
              purchase.status == PurchaseStatus.restored) {
            // The server verifies via webhook; we just acknowledge delivery.
            try {
              await InAppPurchase.instance.completePurchase(purchase);
            } catch (_) {}
          }
          if (!_purchaseEvents.isClosed) _purchaseEvents.add(purchase);
        }
      },
      onError: (_) {},
    );
  }

  /// Opens the Stripe/LemonSqueezy customer portal (direct flavor), where the
  /// user can manage/renew/cancel. Store-flavor users manage subscriptions in
  /// the Play Store / App Store app instead.
  Future<void> openManageSubscription() async {
    if (AppConfig.isStoreFlavor) {
      throw const StoreBillingInactiveException('store');
    }
    final url = await _api.createPortal();
    final ok = await launchUrl(url, mode: LaunchMode.externalApplication);
    if (!ok) {
      throw ApiException(
          code: 'browser_failed',
          message: 'Could not open the billing portal: $url');
    }
  }

  Future<void> dispose() async {
    await _purchaseSub?.cancel();
    await _purchaseEvents.close();
  }
}
