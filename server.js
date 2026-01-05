require("dotenv").config();

const express = require("express");
const nodemailer = require("nodemailer");
const swaggerUi = require("swagger-ui-express");

/* =========================
   ENV CONFIG
========================= */
const PORT = process.env.PORT || 3000;

const SMTP_HOST = process.env.SMTP_HOST || "smtp.gmail.com";
const SMTP_PORT = Number(process.env.SMTP_PORT || 465);
const SMTP_SECURE =
  process.env.SMTP_SECURE?.toLowerCase() === "true" || SMTP_PORT === 465;
const SMTP_USER = process.env.SMTP_USER;
const SMTP_PASS = process.env.SMTP_PASS;

const INVITE_FROM_NAME =
  process.env.INVITE_FROM_NAME || "Attendance Platform";
const INVITE_FROM_EMAIL = process.env.INVITE_FROM_EMAIL || SMTP_USER;
const INVITE_REPLY_TO = process.env.INVITE_REPLY_TO || undefined;
const INVITE_EMAIL_API_KEY = process.env.INVITE_EMAIL_API_KEY || null;

const INVITE_ALLOWED_ORIGINS = (
  process.env.INVITE_ALLOWED_ORIGINS || "*"
)
  .split(",")
  .map((o) => o.trim());

const allowAnyOrigin = INVITE_ALLOWED_ORIGINS.includes("*");

/* =========================
   EXPRESS APP
========================= */
const app = express();
app.use(express.json({ limit: "250kb" }));

/* =========================
   CORS
========================= */
app.use((req, res, next) => {
  const origin = req.headers.origin;

  if (allowAnyOrigin) {
    res.setHeader("Access-Control-Allow-Origin", "*");
  } else if (origin && INVITE_ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  }

  res.setHeader("Vary", "Origin");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, X-API-Key"
  );
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");

  if (req.method === "OPTIONS") {
    return res.sendStatus(204);
  }
  next();
});

/* =========================
   SMTP TRANSPORT
========================= */
const transporter =
  SMTP_USER && SMTP_PASS
    ? nodemailer.createTransport({
        host: SMTP_HOST,
        port: SMTP_PORT,
        secure: SMTP_SECURE,
        auth: {
          user: SMTP_USER,
          pass: SMTP_PASS,
        },
      })
    : null;

/* =========================
   HELPERS
========================= */
function extractEmail(value) {
  if (!value || typeof value !== "string") return null;
  const match = value.match(/<([^>]+)>/);
  const email = (match ? match[1] : value).trim().toLowerCase();
  return email.includes("@") ? email : null;
}

function formatFrom(name, email) {
  if (!email) return null;
  return name ? `${name} <${email}>` : email;
}

function buildInviteEmail({
  firstName,
  lastName,
  role,
  organizationName,
  link,
}) {
  const recipient =
    [firstName, lastName].filter(Boolean).join(" ") || "there";
  const org = organizationName || "Attendance Platform";
  const roleLabel = role ? role.replace(/_/g, " ") : "member";

  return {
    subject: `You're invited to ${org}`,
    text: `Hi ${recipient},

You've been invited to join ${org} as a ${roleLabel}.
Use the link below to complete your registration:

${link}

If you did not expect this email, you can ignore it.`,
    html: `
      <p>Hi ${recipient},</p>
      <p>
        You've been invited to join <strong>${org}</strong>
        as a <strong>${roleLabel}</strong>.
      </p>
      <p>
        <a href="${link}" target="_blank">Click here to finish registration</a>
      </p>
      <p>If you did not expect this email, you can ignore it.</p>
    `,
  };
}

/* =========================
   SWAGGER CONFIG
========================= */
const swaggerSpec = {
  openapi: "3.0.3",
  info: {
    title: "Invite Email API",
    version: "1.0.0",
    description: "Send invitation emails using SMTP",
  },
  servers: [{ url: "/" }],
  components: {
    securitySchemes: {
      ApiKeyAuth: {
        type: "apiKey",
        in: "header",
        name: "x-api-key",
      },
    },
  },
  paths: {
    "/health": {
      get: {
        summary: "Health check",
        responses: {
          200: {
            description: "OK",
          },
        },
      },
    },
    "/send-invite-email": {
      post: {
        summary: "Send invite email",
        security: [{ ApiKeyAuth: [] }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              example: {
                email: "user@gmail.com",
                link: "https://example.com/register",
                first_name: "John",
                last_name: "Doe",
                role: "Student",
                organization_name: "My School",
              },
            },
          },
        },
        responses: {
          200: { description: "Email sent" },
          400: { description: "Invalid request" },
          401: { description: "Unauthorized" },
          500: { description: "SMTP error" },
        },
      },
    },
  },
};

/* =========================
   ROUTES
========================= */
app.get("/health", (req, res) => {
  res.json({ ok: true });
});

app.get("/openapi.json", (req, res) => {
  res.json(swaggerSpec);
});

app.use("/docs", swaggerUi.serve, swaggerUi.setup(swaggerSpec));

app.post("/send-invite-email", async (req, res) => {
  if (INVITE_EMAIL_API_KEY) {
    if (req.get("x-api-key") !== INVITE_EMAIL_API_KEY) {
      return res.status(401).json({ error: "Unauthorized" });
    }
  }

  const email = extractEmail(req.body.email);
  const link = req.body.link;

  if (!email || !link) {
    return res
      .status(400)
      .json({ error: "Email and link are required" });
  }

  if (!transporter) {
    return res
      .status(500)
      .json({ error: "SMTP not configured" });
  }

  const mail = buildInviteEmail({
    firstName: req.body.first_name,
    lastName: req.body.last_name,
    role: req.body.role,
    organizationName: req.body.organization_name,
    link,
  });

  try {
    const info = await transporter.sendMail({
      from: formatFrom(INVITE_FROM_NAME, INVITE_FROM_EMAIL),
      to: email,
      subject: mail.subject,
      text: mail.text,
      html: mail.html,
      replyTo: INVITE_REPLY_TO,
    });

    res.json({ delivered: true, messageId: info.messageId });
  } catch (err) {
    res
      .status(502)
      .json({ delivered: false, error: err.message });
  }
});

/* =========================
   START SERVER
========================= */
app.listen(PORT, () => {
  console.log(`Invite Email API running on port ${PORT}`);
});
