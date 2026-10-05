$ErrorActionPreference = "Stop"

Write-Host ""
Write-Host "=============================================" -ForegroundColor Cyan
Write-Host " Client Default Admin Provisioning"
Write-Host "=============================================" -ForegroundColor Cyan
Write-Host ""

# ------------------------------------------------------------
# REQUIRED ENVIRONMENT VARIABLES
# ------------------------------------------------------------

$SupabaseUrl = $env:SUPABASE_URL
$ServiceRoleKey = $env:SUPABASE_SERVICE_ROLE_KEY

if ([string]::IsNullOrWhiteSpace($SupabaseUrl)) {
    throw "SUPABASE_URL is not set."
}

if ([string]::IsNullOrWhiteSpace($ServiceRoleKey)) {
    throw "SUPABASE_SERVICE_ROLE_KEY is not set."
}

# ------------------------------------------------------------
# CLIENT ADMIN DETAILS
#
# Email/password are supplied for THIS client only.
# They are never stored in the Master Template.
# ------------------------------------------------------------

$AdminEmail = $env:DEFAULT_ADMIN_EMAIL
$AdminUsername = if ($env:DEFAULT_ADMIN_USERNAME) {
    $env:DEFAULT_ADMIN_USERNAME
} else {
    "admin"
}

$AdminFullName = if ($env:DEFAULT_ADMIN_FULL_NAME) {
    $env:DEFAULT_ADMIN_FULL_NAME
} else {
    "Administrator"
}

if ([string]::IsNullOrWhiteSpace($AdminEmail)) {
    throw "DEFAULT_ADMIN_EMAIL is not set."
}

$SecurePassword = Read-Host "Enter the temporary password for $AdminEmail" -AsSecureString

$PasswordPtr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($SecurePassword)

try {
    $AdminPassword = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($PasswordPtr)
}
finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($PasswordPtr)
}

if ([string]::IsNullOrWhiteSpace($AdminPassword)) {
    throw "A password is required."
}

if ($AdminPassword.Length -lt 8) {
    throw "The password must contain at least 8 characters."
}

# ------------------------------------------------------------
# HEADERS
# ------------------------------------------------------------

$Headers = @{
    "apikey"        = $ServiceRoleKey
    "Authorization" = "Bearer $ServiceRoleKey"
    "Content-Type"  = "application/json"
}

# ------------------------------------------------------------
# NORMALIZE EMAIL
# ------------------------------------------------------------

$AdminEmail = $AdminEmail.Trim().ToLowerInvariant()

Write-Host "Supabase project:" $SupabaseUrl
Write-Host "Admin username :" $AdminUsername
Write-Host "Admin email    :" $AdminEmail
Write-Host ""

# ------------------------------------------------------------
# CHECK WHETHER PROFILE ALREADY EXISTS
# ------------------------------------------------------------

$EncodedEmail = [Uri]::EscapeDataString($AdminEmail)

$ExistingProfileUrl =
    "$SupabaseUrl/rest/v1/users?select=id,username,email,role,is_active,is_deleted&email=eq.$EncodedEmail"

try {
    $ExistingProfile = Invoke-RestMethod `
        -Method Get `
        -Uri $ExistingProfileUrl `
        -Headers $Headers
}
catch {
    throw "Unable to check public.users: $($_.Exception.Message)"
}

if ($ExistingProfile.Count -gt 0) {
    throw "An admin profile already exists for $AdminEmail. No changes were made."
}

# ------------------------------------------------------------
# CREATE SUPABASE AUTH USER
# ------------------------------------------------------------

Write-Host "Creating Supabase Auth user..." -ForegroundColor Yellow

$AuthBody = @{
    email         = $AdminEmail
    password      = $AdminPassword
    email_confirm = $true
    user_metadata = @{
        username  = $AdminUsername
        full_name = $AdminFullName
        role      = "admin"
    }
} | ConvertTo-Json -Depth 10

try {
    $AuthUser = Invoke-RestMethod `
        -Method Post `
        -Uri "$SupabaseUrl/auth/v1/admin/users" `
        -Headers $Headers `
        -Body $AuthBody
}
catch {
    throw "Unable to create Auth user: $($_.Exception.Message)"
}

if ([string]::IsNullOrWhiteSpace($AuthUser.id)) {
    throw "Supabase Auth did not return a user ID."
}

$UserId = $AuthUser.id

Write-Host "Auth user created:" $UserId -ForegroundColor Green

# ------------------------------------------------------------
# CREATE PUBLIC USERS PROFILE
#
# Uses the SECURITY DEFINER bootstrap function created by
# the Master Template SQL migration.
# ------------------------------------------------------------

Write-Host "Creating default admin profile..." -ForegroundColor Yellow

$ProfileBody = @{
    p_user_id    = $UserId
    p_email      = $AdminEmail
    p_username   = $AdminUsername
    p_full_name  = $AdminFullName
} | ConvertTo-Json

try {
    $CreatedProfile = Invoke-RestMethod `
        -Method Post `
        -Uri "$SupabaseUrl/rest/v1/rpc/provision_default_admin_profile" `
        -Headers $Headers `
        -Body $ProfileBody

    if ($null -eq $CreatedProfile) {
        throw "Default admin profile creation returned no payload."
    }
}
catch {
    Write-Host ""
    Write-Host "Profile creation failed. Removing the Auth user..." -ForegroundColor Red

    try {
        Invoke-RestMethod `
            -Method Delete `
            -Uri "$SupabaseUrl/auth/v1/admin/users/$UserId" `
            -Headers $Headers | Out-Null
    }
    catch {
        Write-Warning "The Auth user could not be automatically removed."
        Write-Warning "Auth user ID: $UserId"
    }

    throw "Default admin profile creation failed: $($_.Exception.Message) | Response: $($_.ErrorDetails.Message)"
}

# ------------------------------------------------------------
# VERIFY PROFILE
# ------------------------------------------------------------

$VerifyUrl =
    "$SupabaseUrl/rest/v1/users?select=id,username,full_name,email,role,is_active,is_deleted&id=eq.$UserId"

try {
    $VerifiedProfile = Invoke-RestMethod `
        -Method Get `
        -Uri $VerifyUrl `
        -Headers $Headers
}
catch {
    throw "Admin was created, but verification failed: $($_.Exception.Message)"
}

if ($VerifiedProfile.Count -ne 1) {
    throw "Admin Auth user exists, but the public.users profile could not be verified."
}

$Admin = $VerifiedProfile[0]

# ------------------------------------------------------------
# FINAL VALIDATION
# ------------------------------------------------------------

if ($Admin.role -ne "admin") {
    throw "Provisioned user does not have role='admin'."
}

if ($Admin.is_active -ne $true) {
    throw "Provisioned admin is not active."
}

if ($Admin.is_deleted -ne $false) {
    throw "Provisioned admin is marked as deleted."
}

if ($Admin.username -ne $AdminUsername) {
    throw "Provisioned username does not match."
}

if ($Admin.email -ne $AdminEmail) {
    throw "Provisioned email does not match."
}

# ------------------------------------------------------------
# SUCCESS
# ------------------------------------------------------------

Write-Host ""
Write-Host "=============================================" -ForegroundColor Green
Write-Host " DEFAULT ADMIN CREATED SUCCESSFULLY"
Write-Host "=============================================" -ForegroundColor Green
Write-Host ""
Write-Host "User ID  : $($Admin.id)"
Write-Host "Username : $($Admin.username)"
Write-Host "Name     : $($Admin.full_name)"
Write-Host "Email    : $($Admin.email)"
Write-Host "Role     : $($Admin.role)"
Write-Host "Active   : $($Admin.is_active)"
Write-Host ""
Write-Host "The client can now log in using the supplied credentials."
Write-Host ""
