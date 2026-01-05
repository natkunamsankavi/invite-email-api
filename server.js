require('dotenv').config();

const express = require('express');
const nodemailer = require('nodemailer');
const swaggerUi = require('swagger-ui-express');

const PORT = Number(process.env.PORT || 8787);
const SMTP_HOST = process.env.SMTP_HOST || 'smtp.gmail.com';
const SMTP_PORT = Number(process.env.SMTP_PORT || 465);
const SMTP_SECURE = process.env.SMTP_SECURE
  ? process.env.SMTP_SECURE.toLowerCase() === 'true'
  : SMTP_PORT === 465;
const SMTP_USER = process.env.SMTP_USER || null;
const SMTP_PASS = process.env.SMTP_PASS || null;

const INVITE_FROM_NAME = process.env.INVITE_FROM_NAME || 'Attendance Platform';
const INVITE_FROM_EMAIL = process.env.INVITE_FROM_EMAIL || SMTP_USER;
const INVITE_REPLY_TO = process.env.INVITE_REPLY_TO || null;
const INVITE_EMAIL_API_KEY = process.env.INVITE_EMAIL_API_KEY || null;
const INVITE_ALLOWED_ORIGINS = (process.env.INVITE_ALLOWED_ORIGINS || '*')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

const allowAnyOrigin = INVITE_ALLOWED_ORIGINS.includes('*');
const transporter = SMTP_USER && SMTP_PASS
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

const app = express();

const swaggerSpec = {
  openapi: '3.0.3',
  info: {
    title: 'Invite Email API',
    version: '1.0.0',
    description: 'API for sending invitation emails.',
  },
  servers: [
    {
      url: '/',
      description: 'Current host',
    },
  ],
  components: {
    securitySchemes: {
      ApiKeyAuth: {
        type: 'apiKey',
        in: 'header',
        name: 'x-api-key',
      },
    },
    schemas: {
      InviteRequest: {
        type: 'object',
        required: ['email', 'link'],
        properties: {
          email: { type: 'string', format: 'email' },
          link: { type: 'string', format: 'uri' },
          first_name: { type: 'string' },
          last_name: { type: 'string' },
          role: { type: 'string' },
          organization_name: { type: 'string' },
          from: { type: 'string' },
        },
      },
      InviteResponse: {
        type: 'object',
        properties: {
          delivered: { type: 'boolean' },
          messageId: { type: 'string', nullable: true },
        },
      },
      ErrorResponse: {
        type: 'object',
        properties: {
          error: { type: 'string' },
          delivered: { type: 'boolean' },
          reason: { type: 'string' },
        },
      },
    },
  },
  paths: {
    '/health': {
      get: {
        summary: 'Health check',
        responses: {
          200: {
            description: 'Service is healthy',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: { ok: { type: 'boolean' } },
                },
              },
            },
          },
        },
      },
    },
    '/send-invite-email': {
      post: {
        summary: 'Send an invitation email',
        description: 'Requires `x-api-key` header if INVITE_EMAIL_API_KEY is configured.',
        security: [{ ApiKeyAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/InviteRequest' },
            },
          },
        },
        responses: {
          200: {
            description: 'Email delivered',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/InviteResponse' },
              },
            },
          },
          400: {
            description: 'Invalid request payload',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ErrorResponse' },
              },
            },
          },
          401: {
            description: 'Unauthorized',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ErrorResponse' },
              },
            },
          },
          500: {
            description: 'SMTP configuration error',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ErrorResponse' },
              },
            },
          },
          502: {
            description: 'SMTP send failure',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ErrorResponse' },
              },
            },
          },
        },
      },
    },
  },
};

function applyCors(req, res) {
  const origin = req.headers.origin;
  if (allowAnyOrigin) {
    res.setHeader('Access-Control-Allow-Origin', '*');
  } else if (origin && INVITE_ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-API-Key');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
}

function extractEmail(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const match = trimmed.match(/<([^>]+)>/);
  const email = (match ? match[1] : trimmed).toLowerCase();
  return email.includes('@') ? email : null;
}

function formatFrom(name, email) {
  if (!email) return null;
  if (name) return `${name} <${email}>`;
  return email;
}

function buildInviteBodies({ firstName, lastName, role, organizationName, link }) {
  const recipientName = [firstName, lastName].filter(Boolean).join(' ').trim() || 'there';
  const subjectOrg = (organizationName && organizationName.trim()) || 'Attendance Platform';
  const roleLabel = role ? String(role).replace(/_/g, ' ') : 'member';
  const subject = `You're invited to ${subjectOrg}`;

  const textBody = [
    `Hi ${recipientName},`,
    '',
    `You've been invited to join ${subjectOrg} as a ${roleLabel}.`,
    'Use the link below to set up your username and password:',
    link,
    '',
    'If you were not expecting this email, you can ignore it.',
  ].join('\n');

  const htmlBody = `
    <p>Hi ${recipientName},</p>
    <p>You've been invited to join <strong>${subjectOrg}</strong> as a <strong>${roleLabel}</strong>.</p>
    <p><a href="${link}" target="_blank" rel="noopener noreferrer">Click here to finish registration</a>.</p>
    <p>If you were not expecting this email, you can ignore it.</p>
  `;

  return { subject, textBody, htmlBody };
}

app.use((req, res, next) => {
  applyCors(req, res);
  if (req.method === 'OPTIONS') {
    return res.sendStatus(204);
  }
  return next();
});

app.use(express.json({ limit: '250kb' }));

app.get('/openapi.json', (req, res) => {
  res.json(swaggerSpec);
});

app.use('/docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));

app.get('/health', (req, res) => {
  res.json({ ok: true });
});

app.post('/send-invite-email', async (req, res) => {
  if (INVITE_EMAIL_API_KEY) {
    const providedKey = req.get('x-api-key');
    if (!providedKey || providedKey !== INVITE_EMAIL_API_KEY) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
  }

  const payload = req.body || {};
  const email = extractEmail(payload.email);
  const link = typeof payload.link === 'string' ? payload.link.trim() : '';

  if (!email || !link) {
    return res.status(400).json({ error: 'Email and registration link are required.' });
  }

  if (!transporter || !SMTP_USER || !SMTP_PASS) {
    return res.status(500).json({ error: 'SMTP credentials are not configured.' });
  }

  if (!INVITE_FROM_EMAIL) {
    return res.status(500).json({ error: 'INVITE_FROM_EMAIL is not configured.' });
  }

  const fromAddress = formatFrom(INVITE_FROM_NAME, INVITE_FROM_EMAIL);
  const replyToAddress = INVITE_REPLY_TO || extractEmail(payload.from) || undefined;
  const { subject, textBody, htmlBody } = buildInviteBodies({
    firstName: payload.first_name,
    lastName: payload.last_name,
    role: payload.role,
    organizationName: payload.organization_name,
    link,
  });

  try {
    const info = await transporter.sendMail({
      from: fromAddress,
      to: email,
      subject,
      text: textBody,
      html: htmlBody,
      replyTo: replyToAddress || undefined,
    });

    return res.json({ delivered: true, messageId: info.messageId || null });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to send invitation email.';
    return res.status(502).json({ delivered: false, reason: message });
  }
});

app.listen(PORT, () => {
  console.log(`Invite email API listening on port ${PORT}`);
});
