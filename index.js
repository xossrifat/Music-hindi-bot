const { Client, GatewayIntentBits, MessageActionRow, MessageButton } = require('discord.js');
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
let currentSongIndex = 0; // Track the current song index
let isPaused = false;
let isLooping = false;
let isShuffling = false;

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

    // Get the text channel ID from the environment variable
    const textChannelId = process.env.TEXT_CHANNEL_ID;
    const guild = client.guilds.cache.get(process.env.GUILD_ID);
    
    if (guild) {
        // Fetch the specific text channel by ID
        const textChannel = guild.channels.cache.get(textChannelId);
        
        if (textChannel) {
            textChannel.send(`Now playing: ${path.basename(filePath)}`);
        } else {
            console.error("Text channel not found.");
        }
    }
};

// Function to split the list of songs into chunks of 2000 characters or fewer
const splitMessage = (message, maxLength = 2000) => {
    const messageChunks = [];
    while (message.length > maxLength) {
        let chunk = message.slice(0, maxLength);
        let lastIndex = chunk.lastIndexOf("\n"); // Split at the last newline to avoid cutting a song name
        if (lastIndex === -1) lastIndex = chunk.length; // If no newline, cut at max length
        messageChunks.push(chunk.slice(0, lastIndex));
        message = message.slice(lastIndex);
    }
    messageChunks.push(message); // Add the remaining part
    return messageChunks;
};


// Shuffle the music queue
const shuffleQueue = () => {
    for (let i = musicQueue.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [musicQueue[i], musicQueue[j]] = [musicQueue[j], musicQueue[i]];
    }
    currentSongIndex = 0; // Reset the index to 0 after shuffling
    playNext();
};

// Create the message action row with buttons
const createMusicButtons = () => {
    return new MessageActionRow()
        .addComponents(
            new MessageButton()
                .setCustomId('previous')
                .setLabel('Previous')
                .setStyle('PRIMARY'),
            new MessageButton()
                .setCustomId('next')
                .setLabel('Next')
                .setStyle('PRIMARY'),
            new MessageButton()
                .setCustomId('pause')
                .setLabel('Pause/Resume')
                .setStyle('SECONDARY'),
            new MessageButton()
                .setCustomId('shuffle')
                .setLabel('Shuffle')
                .setStyle('SECONDARY'),
            new MessageButton()
                .setCustomId('loop')
                .setLabel('Loop')
                .setStyle('SECONDARY')
        );
};





// Command handler for bot commands
client.on('messageCreate', async (message) => {
    if (!message.content.startsWith('$') || message.author.bot) return;

    const args = message.content.slice(1).trim().split(/ +/);
    const command = args.shift().toLowerCase();

    // Get the text channel ID from the environment variable
    const textChannelId = process.env.TEXT_CHANNEL_ID;
    const guild = client.guilds.cache.get(process.env.GUILD_ID);
    
    if (!guild) {
        return message.reply('Guild not found.');
    }

    // Fetch the specific text channel by ID
    const textChannel = guild.channels.cache.get(textChannelId);
    
    if (!textChannel) {
        return message.reply('Text channel not found.');
    }

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
            textChannel.send(`Now playing: ${fileName}`);
        } else if (!fileName) {
            if (!currentPlayer || !currentConnection) return textChannel.send('No music is currently playing.');
            if (isPaused) {
                currentPlayer.unpause();
                isPaused = false;
                textChannel.send('Playback resumed.');
            } else {
                textChannel.send('Playback is already running.');
            }
        } else {
            textChannel.send(`The file "${fileName}" does not exist in the music folder.`);
        }
    }

    // Pause playback
    if (command === 'pause') {
        if (!currentPlayer || isPaused) {
            return textChannel.send('No music is currently playing or it is already paused.');
        }
        currentPlayer.pause();
        isPaused = true;
        textChannel.send('Playback paused.');
    }

 // Show the player controls
    if (command === 'controls') {
        const controlMessage = await message.reply({
            content: 'Use the buttons below to control the music!',
            components: [createMusicButtons()],
        });
    }
    
    // Resume playback
    if (command === 'resume') {
        if (!currentPlayer || !isPaused) {
            return textChannel.send('No music is currently paused.');
        }
        currentPlayer.unpause();
        isPaused = false;
        textChannel.send('Playback resumed.');
    }

    // Skip to next song
    if (command === 'next') {
       const filePath = musicQueue.shift();
       const resource = createAudioResource(fs.createReadStream(filePath));
        if (musicQueue.length === 0) {
            return textChannel.send('The queue is empty. Add more songs to play next.');
        }
        playNext();
        textChannel.send(`Playing the next song in the queue. Now playing: ${path.basename(filePath)}.`);
    }

    // Show the number of songs and their names in the music folder
    // List songs in the Music folder
    if (command === 'list') {
        const musicFolderPath = path.join(__dirname, 'Music');
        const musicFiles = fs.readdirSync(musicFolderPath).filter(file => file.endsWith('.mp3'));
        
        let songList = '';
        musicFiles.forEach((file, index) => {
            songList += `${index + 1}. ${file}\n`;
        });

        // Split the message if it's too long
        const chunks = splitMessage(songList);
        
        // Send each chunk as a separate message
        for (let chunk of chunks) {
            await message.channel.send(chunk);
        }
    }

    // Help command
    if (command === 'help') {
        const helpMessage = `**Available Commands:**
        - \`$play <song>\` - Play a specific song.
        - \`$pause\` - Pause the current song.
        - \`$resume\` - Resume the paused song.
        - \`$next\` - Skip to the next song.
        - \`$list\` - List all songs in the music folder.
        - \`$help\` - Show this help message.`;

        textChannel.send(helpMessage);
    }
});








// Handle button interactions
client.on('interactionCreate', async (interaction) => {
    if (!interaction.isButton()) return;

    if (interaction.customId === 'next') {
        currentSongIndex = (currentSongIndex + 1) % musicQueue.length;
        playNext();
        await interaction.update({ content: `Now playing: ${path.basename(musicQueue[currentSongIndex])}`, components: [createMusicButtons()] });
    } else if (interaction.customId === 'previous') {
        currentSongIndex = (currentSongIndex - 1 + musicQueue.length) % musicQueue.length;
        playNext();
        await interaction.update({ content: `Now playing: ${path.basename(musicQueue[currentSongIndex])}`, components: [createMusicButtons()] });
    } else if (interaction.customId === 'pause') {
        if (isPaused) {
            currentPlayer.unpause();
            isPaused = false;
            await interaction.update({ content: `Resumed playing: ${path.basename(musicQueue[currentSongIndex])}`, components: [createMusicButtons()] });
        } else {
            currentPlayer.pause();
            isPaused = true;
            await interaction.update({ content: 'Playback paused.', components: [createMusicButtons()] });
        }
    } else if (interaction.customId === 'shuffle') {
        isShuffling = !isShuffling;
        if (isShuffling) {
            shuffleQueue();
            await interaction.update({ content: 'Queue shuffled!', components: [createMusicButtons()] });
        } else {
            await interaction.update({ content: 'Shuffle disabled.', components: [createMusicButtons()] });
        }
    } else if (interaction.customId === 'loop') {
        isLooping = !isLooping;
        await interaction.update({ content: isLooping ? 'Looping enabled.' : 'Looping disabled.', components: [createMusicButtons()] });
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
