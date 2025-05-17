$url = "http://127.0.0.1:7865"
$maxAttempts = 30
$attempt = 0

while ($attempt -lt $maxAttempts) {
    try {
        $response = Invoke-WebRequest -Uri $url -Method Get -TimeoutSec 1
        if ($response.StatusCode -eq 200) {
            Write-Host "RVC is ready!"
            exit 0
        }
    }
    catch {
        Write-Host "Waiting for RVC to start... (Attempt $($attempt + 1)/$maxAttempts)"
        Start-Sleep -Seconds 2
    }
    $attempt++
}

Write-Host "RVC failed to start within the timeout period"
exit 1 