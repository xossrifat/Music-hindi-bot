const { Client, GatewayIntentBits } = require('discord.js');
const { VoiceConnectionStatus, entersState, createAudioPlayer, createAudioResource, AudioPlayerStatus, NoSubscriberBehavior, joinVoiceChannel } = require('@discordjs/voice');
const fs = require('fs');
const path = require('path');
require('dotenv').config();
require('./keep-alive');

// Initialize the client with necessary intents
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildVoiceStates,
    ],
});

let musicQueue = [];
let currentPlayer = null;
let currentConnection = null;
let isPaused = false;

// Helper function to load music files from the music folder
const loadMusicQueue = () => {
    const musicFolderPath = path.join(__dirname, 'Music');
    const musicFiles = fs.readdirSync(musicFolderPath).filter(file => file.endsWith('.mp3'));
    return musicFiles.map(file => path.join(musicFolderPath, file));
};

// Function to play the next song in the queue
const playNext = () => {
    if (!currentConnection || musicQueue.length === 0) return;

    const filePath = musicQueue.shift();
    const resource = createAudioResource(fs.createReadStream(filePath));

    currentPlayer.play(resource);

    currentPlayer.on(AudioPlayerStatus.Idle, () => {
        if (musicQueue.length > 0) {
            playNext();
        } else {
            console.log('Queue is empty, stopping playback.');
            currentConnection.destroy();  // Disconnect from the channel when queue is empty
        }
    });

    currentPlayer.on('error', (error) => {
        console.error('Error playing audio:', error);
    });
    message.reply(`Now playing: ${path.basename(filePath)}.`);
    console.log(`Now playing: ${path.basename(filePath)}`);
};

// Command handler for bot commands
client.on('messageCreate', async (message) => {
    if (!message.content.startsWith('$') || message.author.bot) return;

    const args = message.content.slice(1).trim().split(/ +/);
    const command = args.shift().toLowerCase();

    // Play specific song or resume if no song is specified
    if (command === 'play') {
        const fileName = args.join(' '); // Get the file name or specific song
        const musicFolderPath = path.join(__dirname, 'Music');
        const filePath = path.join(musicFolderPath, fileName);

        if (fileName && fs.existsSync(filePath)) {
            musicQueue = [filePath]; // Replace the queue with the specific song
            if (currentPlayer && currentConnection) {
                playNext();
            } else {
                const channelId = process.env.VOICE_CHANNEL_ID;
                const guildId = process.env.GUILD_ID;
                const guild = client.guilds.cache.get(guildId);

                if (!guild) return message.reply('Guild not found.');

                currentConnection = joinVoiceChannel({
                    channelId,
                    guildId,
                    adapterCreator: guild.voiceAdapterCreator,
                });

                currentPlayer = createAudioPlayer({ behaviors: { noSubscriber: NoSubscriberBehavior.Play } });
                currentConnection.subscribe(currentPlayer);

                playNext();
            }
            message.reply(`Now playing: ${fileName}`);
        } else if (!fileName) {
            if (!currentPlayer || !currentConnection) return message.reply('No music is currently playing.');
            if (isPaused) {
                currentPlayer.unpause();
                isPaused = false;
                message.reply('Playback resumed.');
            } else {
                message.reply('Playback is already running.');
            }
        } else {
            message.reply(`The file "${fileName}" does not exist in the music folder.`);
        }
    }

    // Pause playback
    if (command === 'pause') {
        if (!currentPlayer || isPaused) {
            return message.reply('No music is currently playing or it is already paused.');
        }
        currentPlayer.pause();
        isPaused = true;
        message.reply('Playback paused.');
    }

    // Resume playback
    if (command === 'resume') {
        if (!currentPlayer || !isPaused) {
            return message.reply('No music is currently paused.');
        }
        currentPlayer.unpause();
        isPaused = false;
        message.reply('Playback resumed.');
    }

    // Skip to next song
    if (command === 'next') {
       const filePath = musicQueue.shift();
       const resource = createAudioResource(fs.createReadStream(filePath));
        if (musicQueue.length === 0) {
            return message.reply('The queue is empty. Add more songs to play next.');
        }
        playNext();
        message.reply(`Playing the next song in the queue. Now playing: ${path.basename(filePath)}.`);
    }
});

client.once('ready', async () => {
    console.log(`Logged in as ${client.user.tag}!`);
    const guildId = process.env.GUILD_ID;
    const channelId = process.env.VOICE_CHANNEL_ID;

    const guild = client.guilds.cache.get(guildId);
    if (!guild) {
        console.error('Guild not found.');
        return;
    }

    // Join the voice channel and start playing music
    currentConnection = joinVoiceChannel({
        channelId,
        guildId,
        adapterCreator: guild.voiceAdapterCreator,
    });

    currentPlayer = createAudioPlayer({ behaviors: { noSubscriber: NoSubscriberBehavior.Play } });
    currentConnection.subscribe(currentPlayer);

    // Load initial queue and start playback
    musicQueue = loadMusicQueue();
    playNext();
});

client.login(process.env.DISCORD_TOKEN);
