const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");

const { query } = require("../config/database");

function createToken(user) {
  return jwt.sign(
    {
      sub: user.id,
      role: user.role,
    },
    process.env.JWT_SECRET,
    {
      expiresIn: "12h",
    }
  );
}

function sanitizeUser(user) {
  return {
    id: user.id,
    username: user.username,
    full_name: user.full_name,
    email: user.email,
    cellphone: user.cellphone,
    role: user.role,
    is_active: user.is_active,
    is_deleted: user.is_deleted,
  };
}

async function login(req, res) {
  try {
    const email = String(req.body?.email || "").trim();
    const password = String(req.body?.password || "");

    if (!email || !password) {
      return res.status(400).json({
        error: "Email address and password are required.",
      });
    }

    const result = await query(
      `
        SELECT
          u.id,
          u.username,
          u.full_name,
          u.email,
          u.cellphone,
          u.role,
          u.is_active,
          u.is_deleted,
          c.password_hash
        FROM public.users u
        INNER JOIN public.local_user_credentials c
          ON c.user_id = u.id
        WHERE LOWER(u.email) = LOWER($1)
        LIMIT 1
      `,
      [email]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({
        error: "Invalid email address or password.",
      });
    }

    const user = result.rows[0];

    if (!user.is_active || user.is_deleted) {
      return res.status(403).json({
        error: "This user account is inactive.",
      });
    }

    const passwordValid = await bcrypt.compare(
      password,
      user.password_hash
    );

    if (!passwordValid) {
      return res.status(401).json({
        error: "Invalid email address or password.",
      });
    }

    const safeUser = sanitizeUser(user);
    const token = createToken(safeUser);

    return res.json({
      success: true,
      token,
      user: safeUser,
    });
  } catch (error) {
    console.error("LOCAL LOGIN ERROR:", error);

    return res.status(500).json({
      error: "Unable to process the login request.",
    });
  }
}

async function me(req, res) {
  try {
    const userId = req.user?.sub;

    if (!userId) {
      return res.status(401).json({
        error: "Authentication required.",
      });
    }

    const result = await query(
      `
        SELECT
          id,
          username,
          full_name,
          email,
          cellphone,
          role,
          is_active,
          is_deleted
        FROM public.users
        WHERE id = $1
        LIMIT 1
      `,
      [userId]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({
        error: "User account not found.",
      });
    }

    const user = result.rows[0];

    if (!user.is_active || user.is_deleted) {
      return res.status(403).json({
        error: "This user account is inactive.",
      });
    }

    return res.json({
      success: true,
      user: sanitizeUser(user),
    });
  } catch (error) {
    console.error("LOCAL AUTH USER ERROR:", error);

    return res.status(500).json({
      error: "Unable to load the authenticated user.",
    });
  }
}

async function logout(req, res) {
  return res.json({
    success: true,
    message: "Logged out successfully.",
  });
}

module.exports = {
  login,
  me,
  logout,
};