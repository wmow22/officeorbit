require('dotenv').config();
const { App, ExpressReceiver } = require('@slack/bolt');
const express = require('express');
const bodyParser = require('body-parser');
const fs = require('fs');
const cron = require('node-cron');
const path = require('path');
const signingSecret = process.env.SLACK_SIGNING_SECRET;
const token = process.env.SLACK_BOT_TOKEN;

if (!signingSecret || !token) {
  console.error('Error: Missing SLACK_SIGNING_SECRET or SLACK_BOT_TOKEN environment variables.');
  process.exit(1); // Exit app immediately
}

const DATA_FILE = path.join(__dirname, 'data.json');
const MANAGERS_FILE = path.join(__dirname, 'managers.json');

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file));
  } catch (error) {
    console.error(`Failed to read or parse JSON file ${file}:`, error);
    return {};
  }
}
function writeJson(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

// Load managers mapping and data
let managers = readJson(MANAGERS_FILE);
let data = readJson(DATA_FILE);


const receiver = new ExpressReceiver({ signingSecret });
const app = new App({ token, receiver });

// Body parser for express routes
receiver.router.use(bodyParser.json());
receiver.router.use(bodyParser.urlencoded({ extended: true }));

// Utility: Save data to file safely
function saveData() {
  writeJson(DATA_FILE, data);
}

// Utility: Get user avatar & info from Slack API
async function getUserInfo(userId) {
  try {
    const result = await app.client.users.info({ user: userId });
    return result.user;
  } catch (error) {
  console.error('Error updating user status:', error);
}
}

// Update user avatar URLs weekly or on submission
async function updateUserAvatar(userId) {
  const user = await getUserInfo(userId);
  if (!user) return;
  if (!data.users[userId]) data.users[userId] = {};
  data.users[userId].avatar = user.profile.image_72 || null;
  saveData();
}

// Update Slack status emoji & text based on location
async function updateUserStatus(userId, location) {
  const statusMap = {
    "home": { emoji: "🏠", text: "Working from Home" },
    "london": { emoji: "🇬🇧", text: "In London Office" },
    "prague": { emoji: "🇨🇿", text: "In Prague Office" },
    "travel": { emoji: "🚶", text: "Traveling / On the Go" },
    "timeoff": { emoji: "🌴", text: "Time Off" }
  };

  const status = statusMap[location];
  if (!status) return;

  try {
    await app.client.users.profile.set({
      user: userId,
      profile: {
        status_text: status.text,
        status_emoji: status.emoji,
        status_expiration: 0
      }
    });
  } catch (error) {
  console.error('Error updating user status:', error);
}
}

// Slash Command Handler with robust error handling for /officeorbit and /timeoff
receiver.router.post('/slack/commands', async (req, res) => {
  const { command, user_id, text, trigger_id } = req.body;

  console.log(`Received command: ${command} from user ${user_id} with text: "${text}"`);
receiver.router.post('/slack/commands', async (req, res) => {
  const { command, user_id, text, trigger_id } = req.body;

  try {
    if (command === '/officeorbit') {
      const weekOption = (text && text.trim().toLowerCase()) === 'next' ? 'next' : 'current';

      const modal = {
        type: 'modal',
        callback_id: 'submit_plan',
        private_metadata: weekOption,
        title: { type: 'plain_text', text: 'Submit Working Location Plan' },
        submit: { type: 'plain_text', text: 'Submit' },
        close: { type: 'plain_text', text: 'Cancel' },
        blocks: []
      };

      const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];
      const locations = [
        { text: '🏠 Working from Home', value: 'home' },
        { text: '🇬🇧 London Office', value: 'london' },
        { text: '🇨🇿 Prague Office', value: 'prague' },
        { text: '🚶 Traveling / On the Go', value: 'travel' },
        { text: '🌴 Time Off', value: 'timeoff' }
      ];

      days.forEach((day, idx) => {
        modal.blocks.push({
          type: 'input',
          block_id: `day_${idx}`,
          label: { type: 'plain_text', text: day },
          element: {
            type: 'static_select',
            action_id: 'location_select',
            options: locations.map(loc => ({
              text: { type: 'plain_text', text: loc.text },
              value: loc.value
            }))
          }
        });
      });

      await app.client.views.open({ trigger_id, view: modal });
      return res.status(200).send('');
    }

    if (command === '/timeoff') {
      const modal = {
        type: 'modal',
        callback_id: 'submit_timeoff',
        title: { type: 'plain_text', text: 'Submit Time Off Request' },
        submit: { type: 'plain_text', text: 'Submit' },
        close: { type: 'plain_text', text: 'Cancel' },
        blocks: [
          {
            type: 'input',
            block_id: 'dates',
            label: { type: 'plain_text', text: 'Select Date(s)' },
            element: {
              type: 'datepicker',
              action_id: 'date_picker'
            }
          },
          {
            type: 'input',
            block_id: 'leave_type',
            label: { type: 'plain_text', text: 'Leave Type' },
            element: {
              type: 'static_select',
              action_id: 'leave_type_select',
              options: [
                { text: { type: 'plain_text', text: 'Holiday' }, value: 'holiday' },
                { text: { type: 'plain_text', text: 'Sick' }, value: 'sick' },
                { text: { type: 'plain_text', text: 'Other' }, value: 'other' }
              ]
            }
          },
          {
            type: 'input',
            block_id: 'half_full',
            label: { type: 'plain_text', text: 'Duration' },
            element: {
              type: 'static_select',
              action_id: 'half_full_select',
              options: [
                { text: { type: 'plain_text', text: 'Full Day' }, value: 'full' },
                { text: { type: 'plain_text', text: 'Half Day AM' }, value: 'am' },
                { text: { type: 'plain_text', text: 'Half Day PM' }, value: 'pm' }
              ]
            }
          }
        ]
      };

      await app.client.views.open({ trigger_id, view: modal });
      return res.status(200).send('');
    }

    // Add handlers for other commands here if needed

    return res.status(200).send(`Command ${command} received`);
  } catch (err) {
    console.error('Error handling slash command:', err);
    return res.status(500).send('Internal server error');
  }
});

// View submissions handling
app.view('submit_plan', async ({ ack, body, view, client }) => {
  await ack();
  const user = body.user.id;
  const week = view.private_metadata; // 'current' or 'next'

  const selections = {};
  for (const block of view.blocks) {
    if (block.block_id.startsWith('day_')) {
      const val = view.state.values[block.block_id].location_select.selected_option.value;
      selections[block.block_id] = val;
    }
  }

  if (!data.plans[user]) data.plans[user] = {};
  data.plans[user][week] = {
    locations: selections,
    timestamp: Date.now()
  };
  saveData();

  await updateUserAvatar(user);
  const mondayLoc = selections['day_0'] || 'home';
  await updateUserStatus(user, mondayLoc);

  try {
    await client.chat.postMessage({
      channel: user,
      text: `Your ${week} week working location plan was saved successfully!`
    });
  } catch (err) {
    console.error('Error sending confirmation message:', err);
  }
});

// Time off submission handler (implement similarly)
// ...

(async () => {
  await app.start(process.env.PORT || 3000);
  console.log('⚡️ OfficeOrbit Slack app is running!');
})();