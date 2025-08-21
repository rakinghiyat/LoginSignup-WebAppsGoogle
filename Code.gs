// Global variable for the spreadsheet and user sheet
var SPREADSHEET_NAME = "LOGIN";
var USER_SHEET_NAME = "Users";
var REDIRECT_URL = "https://gwaddons.com"; // Default URL to redirect after successful login

function doGet(e) {
  // Handle email verification link
  if (e.parameter.token) {
    return handleEmailVerification(e.parameter.token);
  }

  // Serve the main web app HTML
  var htmlOutput = HtmlService.createTemplateFromFile('index');
  return htmlOutput.evaluate()
      .setTitle('GW Add-ons Login & Signup')
      .setSandboxMode(HtmlService.SandboxMode.IFRAME)
      .addMetaTag('viewport', 'width=device-width, initial-scale=1')
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/**
 * Gets the specified sheet from the active spreadsheet.
 * @param {string} sheetName The name of the sheet to retrieve.
 * @returns {GoogleAppsScript.Spreadsheet.Sheet} The sheet object.
 */
function getSheet(sheetName) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  return ss.getSheetByName(sheetName);
}

/**
 * Generates a unique verification token.
 * @returns {string} A unique token.
 */
function generateVerificationToken() {
  return Utilities.getUuid(); // Generates a unique ID
}

/**
 * Generates a 6-digit OTP.
 * @returns {string} A 6-digit OTP.
 */
function generateOTP() {
  return Math.floor(100000 + Math.random() * 900000).toString(); // 6-digit number
}

/**
 * Sends an email.
 * @param {string} recipient The email address of the recipient.
 * @param {string} subject The subject of the email.
 * @param {string} body The body of the email.
 */
function sendEmail(recipient, subject, body) {
  MailApp.sendEmail(recipient, subject, body);
}

/**
 * Checks if an email is valid.
 * @param {string} email The email to validate.
 * @returns {boolean} True if the email is valid, false otherwise.
 */
function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

/**
 * Retrieves user data by email.
 * @param {string} email The email of the user.
 * @returns {Array} The user's row data or null if not found.
 */
function getUserByEmail(email) {
  var sheet = getSheet(USER_SHEET_NAME);
  var data = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) { // Skip header row
    if (data[i][2].toLowerCase() === email.toLowerCase()) { // Column C is Email (index 2)
      return { row: i, data: data[i] };
    }
  }
  return null;
}

/**
 * Retrieves user data by verification token.
 * @param {string} token The verification token.
 * @returns {Array} The user's row data or null if not found.
 */
function getUserByToken(token) {
  var sheet = getSheet(USER_SHEET_NAME);
  var data = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) { // Skip header row
    if (data[i][9] && data[i][9] === token) { // Column J is Verification Token (index 9)
      return { row: i, data: data[i] };
    }
  }
  return null;
}

/**
 * Retrieves user data by OTP.
 * @param {string} email The email of the user.
 * @param {string} otp The OTP.
 * @returns {Array} The user's row data or null if not found or OTP expired.
 */
function getUserByOTP(email, otp) {
  var user = getUserByEmail(email);
  if (user) {
    var storedOtp = user.data[6]; // Column G is OTP (index 6)
    var otpExpiry = user.data[7]; // Column H is DATE OF EXPIRY (index 7)

    if (storedOtp == otp && otpExpiry && new Date() < new Date(otpExpiry)) {
      return user;
    }
  }
  return null;
}

/**
 * Updates a specific field for a user in the sheet.
 * @param {number} row The row index of the user (0-indexed).
 * @param {number} colIndex The column index to update (0-indexed).
 * @param {any} value The new value.
 */
function updateUserField(row, colIndex, value) {
  var sheet = getSheet(USER_SHEET_NAME);
  sheet.getRange(row + 1, colIndex + 1).setValue(value); // +1 for 1-indexed sheet
}

// --- Password Hashing Functions ---

/**
 * Generates a random salt.
 * @returns {string} A random 16-character hexadecimal string.
 */
function generateSalt() {
  return Utilities.getUuid().replace(/-/g, ''); // Generate a UUID and remove hyphens for a shorter salt
}

/**
 * Hashes a password with a given salt using SHA-256.
 * It performs multiple iterations (stretching) for stronger security.
 * @param {string} password The plain text password.
 * @param {string} salt The unique salt for the user.
 * @param {number} iterations (Optional) Number of hashing iterations. Default to 10000.
 * @returns {string} The hashed password.
 */
function hashPassword(password, salt, iterations = 10) {
  let combined = password + salt;
  let hash = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, combined);
  for (let i = 0; i < iterations - 1; i++) {
    // Re-hash the hash itself, encoding it to base64 for proper input format
    // and then decoding to bytes for computeDigest to avoid errors with byte array vs string.
    // This is a common pattern for stretching with raw digest functions.
    hash = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, Utilities.base64Decode(Utilities.base64Encode(hash)));
  }
  return Utilities.base64Encode(hash); // Encode the final hash to base64 for storage
}


/**
 * Processes user signup request.
 * @param {Object} formData Contains name, email, and password.
 * @returns {Object} Success status and message.
 */
function processSignup(formData) {
  try {
    var sheet = getSheet(USER_SHEET_NAME);
    if (!sheet) {
      return { success: false, message: "Sheet 'Users' not found. Please check your Google Sheet setup." };
    }

    var email = formData.email;
    if (!isValidEmail(email)) {
      return { success: false, message: "Please enter a valid email address!" };
    }

    // Check for duplicate email
    var existingUser = getUserByEmail(email);
    if (existingUser) {
      return { success: false, message: "Email already registered!" };
    }

    var salt = generateSalt(); // Generate unique salt for new user
    var hashedPassword = hashPassword(formData.password, salt); // Hash the password

    var verificationToken = generateVerificationToken();
    var webAppUrl = ScriptApp.getService().getUrl();
    var verificationLink = webAppUrl + '?token=' + verificationToken;

    // Append new user with "Pending" status, verification token, HASHED password, and salt
    // MAKE SURE TO ADD A 'Salt' COLUMN IN YOUR GOOGLE SHEET (e.g., Column K, index 10)
    sheet.appendRow([
      formData.name,
      formData.title,
      formData.email,
      hashedPassword, // Column D (index 3) - Storing the hashed password
      "Allowed",
      REDIRECT_URL,
      "", // OTP - Column G (index 6)
      "", // DATE OF EXPIRY - Column H (index 7)
      "Pending", // Status: Pending verification - Column I (index 8)
      verificationToken, // Verification Token - Column J (index 9)
      salt // Salt - Column K (index 10)
    ]);

    // Send verification email
    var emailBody = "Hello " + formData.name + ",\n\n" +
                    "Thank you for registering. Please click the link below to verify your email address:\n\n" +
                    verificationLink + "\n\n" +
                    "This link will expire in 24 hours.\n\n" + // Note: actual expiry logic for link is not in this script
                    "Regards,\nYour App Team";
    sendEmail(formData.email, "Verify Your Email for Your App", emailBody);

    return { success: true, message: "Registration successful! A verification link has been sent to your email. Please verify your email to log in." };

  } catch (e) {
    Logger.log(e.toString());
    return { success: false, message: "Error during registration: " + e.message };
  }
}

/**
 * Handles email verification when the user clicks the link.
 * @param {string} token The verification token from the URL.
 * @returns {GoogleAppsScript.HTML.HtmlOutput} HTML content indicating verification status.
 */
function handleEmailVerification(token) {
  var user = getUserByToken(token);
  if (user && user.data[8] === "Pending") { // Column I is Status (index 8)
    updateUserField(user.row, 8, "Verified"); // Set Status to Verified
    updateUserField(user.row, 9, ""); // Clear Verification Token (Column J, index 9)
    return HtmlService.createHtmlOutput('<p style="font-family: sans-serif; text-align: center; color: green; font-size: 1.2em;">Your email has been successfully verified! You can now log in.</p>');
  } else {
    return HtmlService.createHtmlOutput('<p style="font-family: sans-serif; text-align: center; color: red; font-size: 1.2em;">Invalid or expired verification link.</p>');
  }
}

/**
 * Processes user login request.
 * @param {Object} formData Contains email and password.
 * @returns {Object} Success status, message, and redirect URL.
 */
function processLogin(formData) {
  try {
    var email = formData.email;
    var enteredPassword = formData.password; // Get plain text password entered by user

    var user = getUserByEmail(email);

    if (!user) {
      return { success: false, message: "Invalid email or password." };
    }

    var userData = user.data;
    var storedHashedPassword = userData[3]; // Column D is Hashed Password (index 3)
    var storedSalt = userData[10]; // Column K is Salt (index 10)
    var status = userData[8]; // Column I is Status (index 8)
    var type = userData[4]; // Column E is Type (index 4)

    if (status === "Pending") {
      return { success: false, message: "Your email is not verified. Please check your inbox for the verification link.", unverified: true };
    }
    
    if (type === "Blocked") { // Check if user account is blocked
      return { success: false, message: "Your account has been blocked. Please contact support." };
    }

    // Hash the entered password with the stored salt for comparison
    var hashedEnteredPassword = hashPassword(enteredPassword, storedSalt);
    
    
    // if (enteredPassword == storedHashedPassword) {  // If Hashing is not implemented
    if (hashedEnteredPassword == storedHashedPassword) {
      return { success: true, message: "Login successful!", redirectUrl: userData[5] || REDIRECT_URL }; // Column F is URL (index 5)
    } else {
      return { success: false, message: "Invalid email or password." };
    }

  } catch (e) {
    Logger.log(e.toString());
    return { success: false, message: "Error during login: " + e.message };
  }
}

/**
 * Resends the email verification link.
 * @param {string} email The email of the user.
 * @returns {Object} Success status and message.
 */
function resendVerificationLink(email) {
  try {
    var user = getUserByEmail(email);
    if (!user) {
      return { success: false, message: "Email not found." };
    }

    if (user.data[8] === "Verified") { // Status column H (index 8)
      return { success: false, message: "Email already verified. Please try logging in." };
    }

    var newVerificationToken = generateVerificationToken();
    var webAppUrl = ScriptApp.getService().getUrl();
    var verificationLink = webAppUrl + '?token=' + newVerificationToken;

    updateUserField(user.row, 9, newVerificationToken); // Update Verification Token column J (index 9)

    var emailBody = "Hello " + user.data[0] + ",\n\n" + // Name column A (index 0)
                    "You requested a new verification link. Please click the link below to verify your email address:\n\n" +
                    verificationLink + "\n\n" +
                    "This link will expire in 24 hours.\n\n" + // Note: actual expiry logic for link is not in this script
                    "Regards,\nYour App Team";
    sendEmail(email, "New Verification Link for Your App", emailBody);

    return { success: true, message: "A new verification link has been sent to your email." };

  } catch (e) {
    Logger.log(e.toString());
    return { success: false, message: "Error resending verification link: " + e.message };
  }
}

/**
 * Sends an OTP for password reset.
 * @param {string} email The email to send OTP to.
 * @returns {Object} Success status and message.
 */
function sendPasswordResetOTP(email) {
  try {
    var user = getUserByEmail(email);

    if (!user) {
      return { success: false, message: "Email not registered." };
    }

    // Only allow OTP for verified accounts for security
    if (user.data[8] !== "Verified") { // Status column I (index 8)
        return { success: false, message: "Your account is not verified. Please verify your email first." };
    }

    var otp = generateOTP();
    var expiryTime = new Date();
    expiryTime.setMinutes(expiryTime.getMinutes() + 10); // OTP valid for 10 minutes

    updateUserField(user.row, 6, otp); // Update OTP column G (index 6)
    updateUserField(user.row, 7, expiryTime); // Update DATE OF EXPIRY column H (index 7)

    var emailBody = "Hello " + user.data[0] + ",\n\n" + // Name column A (index 0)
                    "You have requested to reset your password. Please use the following OTP to verify your identity:\n\n" +
                    "**" + otp + "**\n\n" +
                    "Important: This OTP will expire in 10 minutes for security reasons.\n\n" +
                    "If you didn't request this password reset, please ignore this email. Your password will remain unchanged.\n\n" +
                    "This is an automated message. Please do not reply to this email.";
    sendEmail(email, "Password Reset - OTP Verification", emailBody);

    return { success: true, message: "OTP has been sent to your email. Please check your inbox." };

  } catch (e) {
    Logger.log(e.toString());
    return { success: false, message: "Error sending OTP: " + e.message };
  }
}

/**
 * Verifies the entered OTP.
 * @param {string} email The email of the user.
 * @param {string} otp The entered OTP.
 * @returns {Object} Success status and message.
 */
function verifyOTP(email, otp) {
  var user = getUserByOTP(email, otp);
  if (user) {
    return { success: true, message: "OTP verified successfully!" };
  } else {
    return { success: false, message: "Invalid or expired OTP." };
  }
}

/**
 * Resets the user's password after OTP verification.
 * @param {string} email The email of the user.
 * @param {string} newPassword The new password.
 * @returns {Object} Success status and message.
 */
function resetPassword(email, newPassword) {
  try {
    var user = getUserByEmail(email);
    if (user) {
      // Re-hash the new password with the existing salt
      var salt = user.data[10]; // Retrieve existing salt (Column K, index 10)
      var newHashedPassword = hashPassword(newPassword, salt);

      updateUserField(user.row, 3, newHashedPassword); // Update Hashed Password column D (index 3)
      updateUserField(user.row, 6, ""); // Clear OTP column G (index 6)
      updateUserField(user.row, 7, ""); // Clear DATE OF EXPIRY column H (index 7)
      return { success: true, message: "Password reset successfully!" };
    }
    return { success: false, message: "User not found." };
  } catch (e) {
    Logger.log(e.toString());
    return { success: false, message: "Error resetting password: " + e.message };
  }
}