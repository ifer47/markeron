# Generate a self-signed code-signing certificate for MarkerOn
# Usage: powershell -ExecutionPolicy Bypass -File scripts/generate-cert.ps1

param(
    [string]$Password = "MarkerOn2026!",
    [string]$OutputDir = (Split-Path -Parent $PSScriptRoot)
)

$pfxPath = Join-Path $OutputDir "codesign.pfx"
$cerPath = Join-Path $OutputDir "codesign.cer"
$thumbprintPath = Join-Path $OutputDir ".cert-thumbprint"

$cert = New-SelfSignedCertificate `
    -Subject "CN=MarkerOn Developer, O=MarkerOn" `
    -Type CodeSigningCert `
    -CertStoreLocation "Cert:\CurrentUser\My" `
    -NotAfter (Get-Date).AddYears(3) `
    -KeyAlgorithm RSA `
    -KeyLength 2048 `
    -HashAlgorithm SHA256

Write-Host "Certificate Thumbprint: $($cert.Thumbprint)"
Write-Host "Certificate Subject:    $($cert.Subject)"
Write-Host "Certificate Expiry:     $($cert.NotAfter)"

$securePassword = ConvertTo-SecureString -String $Password -Force -AsPlainText
Export-PfxCertificate -Cert $cert -FilePath $pfxPath -Password $securePassword | Out-Null
Write-Host "PFX exported to: $pfxPath"

Export-Certificate -Cert $cert -FilePath $cerPath | Out-Null
Import-Certificate -FilePath $cerPath -CertStoreLocation "Cert:\CurrentUser\TrustedPublisher" | Out-Null
Write-Host "Certificate added to TrustedPublisher store"

$cert.Thumbprint | Out-File -FilePath $thumbprintPath -NoNewline -Encoding ascii
Write-Host "Thumbprint saved to: $thumbprintPath"

Write-Host "`nDone! You can now sign executables with this certificate."
Write-Host "PFX Password: $Password"
