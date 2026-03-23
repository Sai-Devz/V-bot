console.log("Hello, World!");const { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder } = require('discord.js');
const sqlite3 = require('sqlite3').verbose();

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMembers
  ]
});

// 💾 DATABASE
const db = new sqlite3.Database('./database.sqlite');

db.run(`
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  activityRR INTEGER DEFAULT 0,
  lastMessage INTEGER DEFAULT 0,
  lastActive INTEGER DEFAULT 0,
  dailyTime INTEGER DEFAULT 0,
  lastDay TEXT,
  streak INTEGER DEFAULT 0
)
`);

// 🔧 GET USER
function getUser(id) {
  return new Promise((resolve) => {
    db.get(`SELECT * FROM users WHERE id = ?`, [id], (err, row) => {
      if (!row) {
        const today = new Date().toISOString().split('T')[0];
        db.run(`INSERT INTO users (id, lastActive, lastDay) VALUES (?, ?, ?)`,
          [id, Date.now(), today]);
        resolve({
          id,
          activityRR: 0,
          lastMessage: 0,
          lastActive: Date.now(),
          dailyTime: 0,
          lastDay: today,
          streak: 0
        });
      } else {
        resolve(row);
      }
    });
  });
}

// 💾 UPDATE USER
function updateUser(user) {
  db.run(`
    UPDATE users SET 
    activityRR = ?, lastMessage = ?, lastActive = ?, 
    dailyTime = ?, lastDay = ?, streak = ?
    WHERE id = ?
  `, [
    user.activityRR,
    user.lastMessage,
    user.lastActive,
    user.dailyTime,
    user.lastDay,
    user.streak,
    user.id
  ]);
}

// 🎤 VOICE TRACK
client.on('voiceStateUpdate', async (oldState, newState) => {
  const user = await getUser(newState.id);
  user.lastActive = Date.now();
  updateUser(user);
});

// ⏱️ MAIN LOOP
setInterval(async () => {
  const guild = client.guilds.cache.first();
  if (!guild) return;

  const today = new Date().toISOString().split('T')[0];

  guild.members.cache.forEach(async (member) => {
    if (member.user.bot) return;

    const user = await getUser(member.id);
    const voice = member.voice;

    let isActive = false;

    // 🎤 VALID VOICE (ANTI-AFK)
    if (
      voice.channel &&
      !voice.selfMute &&
      !voice.selfDeaf &&
      voice.channel.members.size > 1
    ) {
      user.activityRR += 5;
      user.dailyTime += 300000;
      isActive = true;
    }

    // 📆 NEW DAY CHECK
    if (user.lastDay !== today) {
      if (user.dailyTime >= 21600000) {
        user.streak += 1;
        user.activityRR += user.streak * 10;
      } else {
        user.streak = 0;
      }

      user.dailyTime = 0;
      user.lastDay = today;
    }

    // ❌ inactivity penalty
    if (!isActive && Date.now() - user.lastActive > 3600000) {
      user.activityRR -= 2;
    }

    if (user.activityRR < 0) user.activityRR = 0;

    updateUser(user);
  });

  console.log("Loop updated");
}, 300000);

// 🧾 SLASH COMMANDS
const commands = [
  new SlashCommandBuilder()
    .setName('rank')
    .setDescription('Check your rank'),

  new SlashCommandBuilder()
    .setName('top')
    .setDescription('Leaderboard')
].map(cmd => cmd.toJSON());

const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);

(async () => {
  await rest.put(
    Routes.applicationCommands(process.env.CLIENT_ID),
    { body: commands }
  );
})();

// ⚡ COMMAND HANDLER
client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;

  const member = interaction.member;
  const user = await getUser(member.user.id);

  const days = Math.floor(
    (Date.now() - member.joinedTimestamp) / (1000 * 60 * 60 * 24)
  );

  const totalRR = (days * 2) + user.activityRR;

  if (interaction.commandName === 'rank') {
    await interaction.reply(
      `🏆 RR: ${totalRR}\n🔥 Streak: ${user.streak}`
    );
  }

  if (interaction.commandName === 'top') {
    db.all(`SELECT * FROM users`, [], async (err, rows) => {
      const leaderboard = [];

      for (const row of rows) {
        const m = await interaction.guild.members.fetch(row.id).catch(() => null);
        if (!m) continue;

        const days = Math.floor(
          (Date.now() - m.joinedTimestamp) / (1000 * 60 * 60 * 24)
        );

        leaderboard.push({
          name: m.user.username,
          rr: (days * 2) + row.activityRR
        });
      }

      leaderboard.sort((a, b) => b.rr - a.rr);

      const top = leaderboard.slice(0, 10)
        .map((u, i) => `${i + 1}. ${u.name} - ${u.rr}`)
        .join("\n");

      interaction.reply(`🏆 Top Players:\n${top}`);
    });
  }
});

client.login(process.env.TOKEN);