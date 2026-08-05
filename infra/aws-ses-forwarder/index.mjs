export async function handler(event) {
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
