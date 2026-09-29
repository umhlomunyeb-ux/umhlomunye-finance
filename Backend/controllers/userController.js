const bcrypt = require("bcrypt");
const { query } = require("../config/database");

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
    created_at: user.created_at,
    updated_at: user.updated_at,
  };
}

async function requireAdmin(req) {
  const userId = req.user?.sub;

  if (!userId) {
    const error = new Error(
      "Authentication required."
    );

    error.status = 401;

    throw error;
  }

  const result = await query(
    `
      SELECT
        id,
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
    const error = new Error(
      "User account not found."
    );

    error.status = 401;

    throw error;
  }

  const user = result.rows[0];

  if (
    String(user.role).toLowerCase() !==
      "admin" ||
    user.is_active === false ||
    user.is_deleted === true
  ) {
    const error = new Error(
      "Only an Administrator can perform this action."
    );

    error.status = 403;

    throw error;
  }

  return user;
}

async function getUsers(req, res) {
  try {
    await requireAdmin(req);

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
          is_deleted,
          created_at,
          updated_at
        FROM public.users
        WHERE is_deleted = false
        ORDER BY created_at DESC
      `
    );

    return res.json({
      success: true,
      users: result.rows.map(
        sanitizeUser
      ),
    });
  } catch (error) {
    console.error(
      "GET USERS ERROR:",
      error
    );

    return res.status(
      error.status || 500
    ).json({
      error:
        error.message ||
        "Unable to load users.",
    });
  }
}

async function createUser(req, res) {
  try {
    await requireAdmin(req);

    const {
      username,
      full_name,
      email,
      cellphone,
      role,
      password,
    } = req.body || {};

    const cleanUsername =
      String(username || "").trim();

    const cleanFullName =
      String(full_name || "").trim();

    const cleanEmail =
      String(email || "").trim();

    const cleanCellphone =
      String(cellphone || "").trim();

    const cleanRole =
      String(role || "user")
        .trim()
        .toLowerCase();

    if (
      !cleanUsername ||
      !cleanFullName ||
      !cleanEmail ||
      !password
    ) {
      return res.status(400).json({
        error:
          "Username, full name, email address and password are required.",
      });
    }

    const existing = await query(
      `
        SELECT id
        FROM public.users
        WHERE LOWER(email) = LOWER($1)
           OR LOWER(username) = LOWER($2)
        LIMIT 1
      `,
      [
        cleanEmail,
        cleanUsername,
      ]
    );

    if (existing.rows.length) {
      return res.status(409).json({
        error:
          "A user with that email address or username already exists.",
      });
    }

    const passwordHash =
      await bcrypt.hash(
        String(password),
        12
      );

    const result = await query(
      `
        INSERT INTO public.users (
          id,
          username,
          full_name,
          email,
          cellphone,
          role,
          is_active,
          is_deleted,
          created_at,
          updated_at
        )
        VALUES (
          gen_random_uuid(),
          $1,
          $2,
          $3,
          $4,
          $5,
          true,
          false,
          now(),
          now()
        )
        RETURNING
          id,
          username,
          full_name,
          email,
          cellphone,
          role,
          is_active,
          is_deleted,
          created_at,
          updated_at
      `,
      [
        cleanUsername,
        cleanFullName,
        cleanEmail,
        cleanCellphone || null,
        cleanRole,
      ]
    );

    const user =
      result.rows[0];

    await query(
      `
        INSERT INTO public.local_user_credentials (
          user_id,
          password_hash,
          created_at,
          updated_at
        )
        VALUES (
          $1,
          $2,
          now(),
          now()
        )
      `,
      [
        user.id,
        passwordHash,
      ]
    );

    return res.status(201).json({
      success: true,
      user: sanitizeUser(user),
    });
  } catch (error) {
    console.error(
      "CREATE USER ERROR:",
      error
    );

    return res.status(
      error.status || 500
    ).json({
      error:
        error.message ||
        "Unable to create user.",
    });
  }
}

async function updateUser(req, res) {
  try {
    await requireAdmin(req);

    const userId =
      req.params.userId;

    if (!userId) {
      return res.status(400).json({
        error:
          "User ID is required.",
      });
    }

    const {
      username,
      full_name,
      email,
      cellphone,
      role,
      is_active,
      password,
    } = req.body || {};

    const existingResult =
      await query(
        `
          SELECT *
          FROM public.users
          WHERE id = $1
          LIMIT 1
        `,
        [userId]
      );

    if (
      existingResult.rows.length ===
      0
    ) {
      return res.status(404).json({
        error:
          "User account not found.",
      });
    }

    const existing =
      existingResult.rows[0];

    const nextUsername =
      username !== undefined
        ? String(username).trim()
        : existing.username;

    const nextFullName =
      full_name !== undefined
        ? String(full_name).trim()
        : existing.full_name;

    const nextEmail =
      email !== undefined
        ? String(email).trim()
        : existing.email;

    const nextCellphone =
      cellphone !== undefined
        ? String(cellphone).trim()
        : existing.cellphone;

    const nextRole =
      role !== undefined
        ? String(role)
            .trim()
            .toLowerCase()
        : existing.role;

    const nextActive =
      is_active !== undefined
        ? Boolean(is_active)
        : existing.is_active;

    const duplicate =
      await query(
        `
          SELECT id
          FROM public.users
          WHERE id <> $1
            AND (
              LOWER(email) = LOWER($2)
              OR LOWER(username) = LOWER($3)
            )
          LIMIT 1
        `,
        [
          userId,
          nextEmail,
          nextUsername,
        ]
      );

    if (duplicate.rows.length) {
      return res.status(409).json({
        error:
          "Another user already has that email address or username.",
      });
    }

    const result =
      await query(
        `
          UPDATE public.users
          SET
            username = $1,
            full_name = $2,
            email = $3,
            cellphone = $4,
            role = $5,
            is_active = $6,
            updated_at = now()
          WHERE id = $7
          RETURNING
            id,
            username,
            full_name,
            email,
            cellphone,
            role,
            is_active,
            is_deleted,
            created_at,
            updated_at
        `,
        [
          nextUsername,
          nextFullName,
          nextEmail,
          nextCellphone || null,
          nextRole,
          nextActive,
          userId,
        ]
      );

    const user =
      result.rows[0];

    if (password) {
      const passwordHash =
        await bcrypt.hash(
          String(password),
          12
        );

      await query(
        `
          INSERT INTO public.local_user_credentials (
            user_id,
            password_hash,
            created_at,
            updated_at
          )
          VALUES (
            $1,
            $2,
            now(),
            now()
          )
          ON CONFLICT (user_id)
          DO UPDATE SET
            password_hash = EXCLUDED.password_hash,
            updated_at = now()
        `,
        [
          userId,
          passwordHash,
        ]
      );
    }

    return res.json({
      success: true,
      user: sanitizeUser(user),
    });
  } catch (error) {
    console.error(
      "UPDATE USER ERROR:",
      error
    );

    return res.status(
      error.status || 500
    ).json({
      error:
        error.message ||
        "Unable to update user.",
    });
  }
}

async function deleteUser(req, res) {
  try {
    await requireAdmin(req);

    const userId =
      req.params.userId;

    if (!userId) {
      return res.status(400).json({
        error:
          "User ID is required.",
      });
    }

    const result =
      await query(
        `
          UPDATE public.users
          SET
            is_active = false,
            is_deleted = true,
            deleted_at = now(),
            deleted_by = $1,
            updated_at = now()
          WHERE id = $2
            AND is_deleted = false
          RETURNING id
        `,
        [
          req.user.sub,
          userId,
        ]
      );

    if (result.rows.length === 0) {
      return res.status(404).json({
        error:
          "User account not found.",
      });
    }

    return res.json({
      success: true,
      message:
        "User deleted successfully.",
    });
  } catch (error) {
    console.error(
      "DELETE USER ERROR:",
      error
    );

    return res.status(
      error.status || 500
    ).json({
      error:
        error.message ||
        "Unable to delete user.",
    });
  }
}

module.exports = {
  getUsers,
  createUser,
  updateUser,
  deleteUser,
};