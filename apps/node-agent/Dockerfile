# VeilVPN node agent — container image.
#
# The agent shells out to the `wg` CLI, so the runtime image must include
# wireguard-tools (a distroless image cannot work). The Go binary itself is
# statically linked (CGO_ENABLED=0).
#
# Runtime requirements (the orchestrator must provide these):
#   --cap-add=NET_ADMIN            (wg set needs netlink privileges)
#   -v veil-agent-state:/var/lib/veil-agent
#   -e AGENT_HMAC_SECRET=...       (min 32 chars; same value as the API's NODE_AGENT_HMAC_SECRET)
#   -e AGENT_TLS_CERT=/tls/cert.pem -e AGENT_TLS_KEY=/tls/key.pem  (mount a volume with the cert)
#
# Build: docker build --build-arg VERSION=1.0.0 -t veil-agent:1.0.0 apps/node-agent

ARG VERSION=dev

FROM golang:1.25-alpine AS build
WORKDIR /src
COPY go.mod ./
# No external dependencies (stdlib only, for easy auditing); this is a no-op
# that keeps the layer cache warm if deps are ever added.
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -trimpath \
    -ldflags "-s -w -X main.version=${VERSION}" \
    -o /out/veil-agent .

FROM alpine:3.20
RUN apk add --no-cache wireguard-tools ca-certificates && \
    adduser -D -H -s /sbin/nologin veil && \
    mkdir -p /var/lib/veil-agent && \
    chown veil:veil /var/lib/veil-agent
COPY --from=build /out/veil-agent /usr/local/bin/veil-agent
USER veil
VOLUME /var/lib/veil-agent
EXPOSE 8443
ENTRYPOINT ["/usr/local/bin/veil-agent"]
