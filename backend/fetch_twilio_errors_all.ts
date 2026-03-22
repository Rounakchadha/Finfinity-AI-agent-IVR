import twilio from 'twilio';
import dotenv from 'dotenv';
dotenv.config();

const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

async function check() {
  const notifications = await client.monitor.v1.alerts.list({limit: 5});
  notifications.forEach(n => console.log(`Error ${n.errorCode}: ${n.alertText}`));
}
check().catch(console.error);
