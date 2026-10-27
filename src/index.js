const JSON_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
};

const MAX_NAME_LENGTH = 120;
const MAX_EMAIL_LENGTH = 254;
const MAX_MESSAGE_LENGTH = 5000;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const RESEND_API_URL = 'https://api.resend.com/emails';

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: JSON_HEADERS,
  });
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, char => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[char]));
}

function isAllowedOrigin(request) {
  const origin = request.headers.get('Origin');
  return !origin || origin === new URL(request.url).origin;
}

async function handleFeedback(request, env) {
  if (request.method !== 'POST') {
    return json({ error: 'Method not allowed.' }, 405);
  }
  if (!isAllowedOrigin(request)) {
    return json({ error: 'Cross-origin requests are not allowed.' }, 403);
  }
  if (!env.RESEND_API_KEY || !env.FEEDBACK_TO || !env.EMAIL_FROM) {
    return json({ error: 'Feedback email is not configured yet.' }, 503);
  }

  let payload;
  try {
    payload = await request.json();
  } catch {
    return json({ error: 'Please send a valid feedback form.' }, 400);
  }

  const name = String(payload?.name || '').trim();
  const email = String(payload?.email || '').trim();
  const message = String(payload?.message || '').trim();
  const honeypot = String(payload?.company || '').trim();

  if (honeypot) return json({ ok: true });
  if (!message) return json({ error: 'Please enter a feedback message.' }, 400);
  if (name.length > MAX_NAME_LENGTH || email.length > MAX_EMAIL_LENGTH || message.length > MAX_MESSAGE_LENGTH) {
    return json({ error: 'One of the fields is too long.' }, 400);
  }
  if (email && !EMAIL_PATTERN.test(email)) {
    return json({ error: 'Please enter a valid reply email, or leave it blank.' }, 400);
  }

  const submittedAt = new Date().toISOString();
  const text = [
    'Rustic Road Trip Planner feedback',
    '',
    `Name: ${name || 'Not provided'}`,
    `Reply email: ${email || 'Not provided'}`,
    `Submitted: ${submittedAt}`,
    '',
    message,
  ].join('\n');
  const html = `
    <h2>Rustic Road Trip Planner feedback</h2>
    <p><strong>Name:</strong> ${escapeHtml(name || 'Not provided')}<br>
    <strong>Reply email:</strong> ${escapeHtml(email || 'Not provided')}<br>
    <strong>Submitted:</strong> ${escapeHtml(submittedAt)}</p>
    <p>${escapeHtml(message).replace(/\n/g, '<br>')}</p>
  `;

  try {
    const response = await fetch(RESEND_API_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY.trim()}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': crypto.randomUUID(),
      },
      body: JSON.stringify({
        from: env.EMAIL_FROM.trim(),
        to: [env.FEEDBACK_TO.trim()],
        reply_to: email || undefined,
        subject: 'Rustic Road Trip Planner feedback',
        text,
        html,
      }),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      console.error(JSON.stringify({ message: 'Feedback email failed', provider: 'resend', status: response.status }));
      return json({ error: 'The feedback email could not be sent. Please try again later.' }, 502);
    }
    return json({ ok: true, messageId: result?.id || null });
  } catch (error) {
    console.error(JSON.stringify({ message: 'Feedback email request failed', provider: 'resend', error: error instanceof Error ? error.message : String(error) }));
    return json({ error: 'The feedback email could not be sent. Please try again later.' }, 502);
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/api/feedback') {
      return handleFeedback(request, env);
    }
    return env.ASSETS.fetch(request);
  },
};
