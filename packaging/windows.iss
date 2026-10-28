; Inno Setup script for the Windows installer. Built by packaging/build.py (iscc /DAppVersion=... etc).
#define AppName "DataDojo"

[Setup]
AppId={{6B6F2C1E-4F3A-4C55-9E2B-DA7AD0DA7A01}
AppName={#AppName}
AppVersion={#AppVersion}
AppPublisher=Sahil Deol
AppPublisherURL=https://github.com/deolsahil/datadojo
DefaultDirName={autopf}\{#AppName}
DefaultGroupName={#AppName}
PrivilegesRequired=lowest
PrivilegesRequiredOverridesAllowed=dialog
OutputDir={#OutDir}
OutputBaseFilename=DataDojo-Windows-Setup
SetupIconFile={#IconFile}
UninstallDisplayIcon={app}\DataDojo.exe
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
ArchitecturesInstallIn64BitMode=x64compatible

[Tasks]
Name: "desktopicon"; Description: "Create a desktop shortcut"; GroupDescription: "Shortcuts:"

[Files]
Source: "{#SourceDir}\*"; DestDir: "{app}"; Flags: recursesubdirs createallsubdirs ignoreversion

[Icons]
Name: "{group}\{#AppName}"; Filename: "{app}\DataDojo.exe"
Name: "{autodesktop}\{#AppName}"; Filename: "{app}\DataDojo.exe"; Tasks: desktopicon

[Run]
Filename: "{app}\DataDojo.exe"; Description: "Launch DataDojo"; Flags: nowait postinstall skipifsilent
