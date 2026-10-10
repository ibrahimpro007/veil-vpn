; VeilVPN Windows installer (Inno Setup 6)
; Built by .github/workflows/release.yml on tag v*.
; Output: VeilVPN-Setup-<version>.exe
;
; SIGNING: the release workflow self-signs with an in-workflow self-signed
; certificate (signtool). Because the cert is NOT from a trusted CA,
; Windows SmartScreen WILL warn on first install ("Unknown publisher").
; This is expected and documented on the download page. A real EV/OV code
; signing certificate is SKIPPED on the $0 budget.

#define AppName "VeilVPN"
#define AppVersion GetEnv("VEIL_VERSION")
#if AppVersion == ""
  #define AppVersion "0.1.0"
#endif
#define AppExe "VeilVPN.exe"
#define HelperExe "veil_helper.exe"

[Setup]
AppName={#AppName}
AppId={{B7C3A91E-4D2F-4E6A-9C1B-7F3E8A2D5C60}
AppVersion={#AppVersion}
AppVerName={#AppName} {#AppVersion}
DefaultDirName={autopf}\{#AppName}
DefaultGroupName={#AppName}
OutputDir=..\dist
OutputBaseFilename=VeilVPN-Setup-{#AppVersion}
Compression=lzma2/max
SolidCompression=yes
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
PrivilegesRequired=admin
WizardStyle=modern
UninstallDisplayName={#AppName}
; AppId GUID: replace with a stable GUID before first public release.

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Files]
; Flutter release build output (flutter build windows --release)
Source: "..\build\windows\x64\runner\Release\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs
; Elevated tunnel helper (dart compile exe windows\helper\veil_helper.dart)
Source: "..\build\helper\{#HelperExe}"; DestDir: "{app}"; Flags: ignoreversion
; Helper installer script
Source: "install_helper.ps1"; DestDir: "{app}"; Flags: ignoreversion

[Icons]
Name: "{group}\{#AppName}"; Filename: "{app}\{#AppExe}"
Name: "{group}\Uninstall {#AppName}"; Filename: "{uninstallexe}"
Name: "{autodesktop}\{#AppName}"; Filename: "{app}\{#AppExe}"; Tasks: desktopicon

[Tasks]
Name: "desktopicon"; Description: "Create a &desktop icon"; GroupDescription: "Additional icons:"; Flags: unchecked

[Run]
; Register the elevated helper service (needs the admin privileges the
; installer already has). /SILENT: skip the wizard checkbox page noise.
Filename: "powershell.exe"; \
  Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{app}\install_helper.ps1"" -HelperExe ""{app}\{#HelperExe}"""; \
  StatusMsg: "Installing VeilVPN helper service..."; Flags: runhidden
Filename: "{app}\{#AppExe}"; Description: "Launch {#AppName}"; Flags: nowait postinstall skipifsilent

[UninstallRun]
; Remove the helper service on uninstall.
Filename: "schtasks.exe"; Parameters: "/Delete /TN VeilVPNHelper /F"; Flags: runhidden
