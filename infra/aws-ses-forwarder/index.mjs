import { SESv2Client, SendEmailCommand } from "@aws-sdk/client-sesv2";

const ses = new SESv2Client({});

export async function handler(event) {
  if (event.requestContext?.http) return sendAlert(event);
  const mail = event.Records?.[0]?.ses?.mail;
  const recipients = event.Records?.[0]?.ses?.receipt?.recipients ?? [];
  if (!mail || recipients.length === 0) throw new Error("Invalid SES receipt event");

  const results = await Promise.all(recipients.map(async (recipient) => {
    const response = await fetch(process.env.PULSEGUARD_WEBHOOK_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-pulseguard-secret": process.env.PULSEGUARD_WEBHOOK_SECRET,
      },
      body: JSON.stringify({ recipient, sender: mail.source, messageId: mail.messageId }),
    });
    if (response.status === 404) return { recipient, ignored: true };
    if (!response.ok) throw new Error(`Pulseguard returned ${response.status}`);
    return { recipient, accepted: true };
  }));

  return { results };
}

async function sendAlert(event) {
  if (event.headers?.["x-pulseguard-secret"] !== process.env.PULSEGUARD_WEBHOOK_SECRET) {
    return { statusCode: 401, body: JSON.stringify({ error: "unauthorized" }) };
  }
  const input = JSON.parse(event.body ?? "{}");
  if (!input.to || !input.subject || !input.text) return { statusCode: 400, body: JSON.stringify({ error: "invalid_request" }) };
  await ses.send(new SendEmailCommand({
    FromEmailAddress: process.env.ALERT_FROM_EMAIL,
    Destination: { ToAddresses: [input.to] },
    Content: { Simple: { Subject: { Data: input.subject }, Body: { Text: { Data: input.text } } } },
  }));
  return { statusCode: 202, body: JSON.stringify({ accepted: true }) };
}
