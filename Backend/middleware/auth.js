const jwt = require("jsonwebtoken");

function authenticateToken(req, res, next) {
  try {
    const authHeader = req.headers.authorization || "";

    if (!authHeader.startsWith("Bearer ")) {
      return res.status(401).json({
        error: "Authentication required.",
      });
    }

    const token = authHeader.slice(7).trim();

    if (!token) {
      return res.status(401).json({
        error: "Authentication required.",
      });
    }

    const decoded = jwt.verify(
      token,
      process.env.JWT_SECRET
    );

    if (!decoded?.sub) {
      return res.status(401).json({
        error: "Invalid authentication token.",
      });
    }

    req.user = decoded;

    next();
  } catch (error) {
    console.error("AUTHENTICATION ERROR:", error);

    return res.status(401).json({
      error: "Invalid or expired authentication token.",
    });
  }
}

module.exports = {
  authenticateToken,
};