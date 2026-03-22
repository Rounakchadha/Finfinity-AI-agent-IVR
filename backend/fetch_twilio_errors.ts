import twilio from 'twilio';
import dotenv from 'dotenv';
dotenv.config();

const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

async function check() {
  const notifications = await client.calls('CA8bc7d48158c3eacf72154cb380e75af7').notifications.list({limit: 5});
  notifications.forEach(n => console.log(`Error ${n.errorCode}: ${n.messageText}`));
}
check().catch(console.error);
