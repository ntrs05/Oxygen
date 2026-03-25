require('dotenv').config();
const {
    Client,
    GatewayIntentBits,
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    Events,
    REST,
    Routes
} = require('discord.js');
const { init, getAuthToken } = require('@heyputer/puter.js/src/init.cjs');
let puter; 
const { level_search } = require('./scraper');

// Client setup
const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent]
});

const systemPrompt = require('./prompt');

// Save chat history for each user
const chatSessions = new Map();

const perPage = 5;

// Create an embed message
function createEmbed(data, query, currentPage, totalPages) {
    const embed = new EmbedBuilder()
        .setTitle(`🔎 Results for \`${query}\``)
        .setDescription(`**Page ${currentPage}/${totalPages}** (Total ${data.length} levels found)\n---`)
        .setColor(0x0099FF)
        .setFooter({ text: "Data provided by The Universal Forums" });

    const startIdx = (currentPage - 1) * perPage;
    const pageData = data.slice(startIdx, startIdx + perPage);

    pageData.forEach((item, index) => {
        const title = `#${startIdx + index + 1}. ${item.song} (ID: ${item.id})`;
        const content = `**Charter:** ${item.charter}\n` +
            `**Difficulty:** ${item.difficulty}\n` +
            `**Artist:** ${item.artist}\n` +
            `**Map Preview:** [Video Link](${item.video_link})\n` +
            `**More info:** [Click here](https://tuforums.com/levels/${item.id})\n\n`;
        embed.addFields({ name: title, value: content, inline: false });
    });

    return embed;
}

// Pagination buttons
function createButtons(currentPage, totalPages) {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('prev')
            .setLabel('Prev')
            .setStyle(ButtonStyle.Primary)
            .setDisabled(currentPage <= 1 || totalPages === 0),
        new ButtonBuilder()
            .setCustomId('next')
            .setLabel('Next')
            .setStyle(ButtonStyle.Primary)
            .setDisabled(currentPage >= totalPages || totalPages === 0)
    );
}

// Bot online
client.once(Events.ClientReady, async () => {
    console.log(`${client.user.tag} is ready!`);

    try {
        console.log("Connecting to Puter AI...");
        
        // If already have a token, use it. Otherwise, get a new one
        if (process.env.PUTER_TOKEN) {
            puter = init(process.env.PUTER_TOKEN);
        } else {
            // If no token available, Puter will automatically open a browser tab to grand access
            const token = await getAuthToken(); 
            puter = init(token);
        }
        console.log("Success!");
    } catch (err) {
        console.error("Error when connecting to Puter:", err);
    }

    // Set up slash commands
    const commands = [{
        name: 'level',
        description: 'Find ADOFAI levels on TUF',
        options: [
            { name: 'level_name', type: 3, description: 'Enter the song you want to search for' },
            { name: 'level_id', type: 4, description: 'Or enter the level ID' },
            { name: 'artist', type: 3, description: 'Or enter the artist name' },
            { name: 'charter', type: 3, description: 'Or enter the charter name' },
            { name: 'difficulty', type: 3, description: 'Level difficulty' }
        ]
    }];

    const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
    try {
        await rest.put(Routes.applicationCommands(client.user.id), { body: commands });
    } catch (error) {
        console.error("Error when registering commands:", error);
    }
});

// Slash command handler
client.on(Events.InteractionCreate, async interaction => {
    if (!interaction.isChatInputCommand()) return;

    if (interaction.commandName === 'level') {
        const level_name = interaction.options.getString('level_name');
        const level_id = interaction.options.getInteger('level_id');
        const artist = interaction.options.getString('artist');
        const charter = interaction.options.getString('charter');
        const difficulty = interaction.options.getString('difficulty');

        if (!level_name && !level_id && !artist && !difficulty && !charter) {
            return interaction.reply({
                content: "Please provide either a level name, charter, a level ID, an artist name, or a difficulty to search for.",
                ephemeral: true
            });
        }

        await interaction.deferReply();

        const results = await level_search({ level_name, level_id, artist, charter, difficulty });

        if (results && results.length > 0) {
            let display_query = "";
            if (level_id) display_query = `ID: ${level_id}`;
            else if (level_name && artist) display_query = `${level_name} (Artist: ${artist})`;
            else if (artist) display_query = `Artist: ${artist}`;
            else if (charter) display_query = `Charter: ${charter}`;
            else if (difficulty) display_query = `Difficulty: ${difficulty}`;
            else display_query = level_name;

            let currentPage = 1;
            const totalPages = Math.ceil(results.length / perPage);

            const responseMessage = await interaction.followUp({
                embeds: [createEmbed(results, display_query, currentPage, totalPages)],
                components: [createButtons(currentPage, totalPages)],
                fetchReply: true
            });

            // Set timeout for button interactions (ms)
            const collector = responseMessage.createMessageComponentCollector({ time: 120000 });

            collector.on('collect', async i => {
                // Block users other than the command invoker from using the buttons
                if (i.user.id !== interaction.user.id) {
                    return i.reply({ content: "These buttons aren't for you!", ephemeral: true });
                }

                if (i.customId === 'prev') currentPage--;
                if (i.customId === 'next') currentPage++;

                await i.update({
                    embeds: [createEmbed(results, display_query, currentPage, totalPages)],
                    components: [createButtons(currentPage, totalPages)]
                });
            });

            // After timeout, disable buttons
            collector.on('end', () => {
                interaction.editReply({ components: [] }).catch(() => { });
            });

        } else {
            await interaction.followUp({ content: "No levels found.", ephemeral: true });
        }
    }
});

client.on(Events.MessageCreate, async message => {
    if (message.author.bot) return;

    // When the bot is mentioned
    if (message.mentions.has(client.user.id)) {
        const userInput = message.content.replace(`<@${client.user.id}>`, '').trim();

        if (!userInput) {
            return message.reply("How can I help?");
        }

        await message.channel.sendTyping();

        try {
            if (!chatSessions.has(message.author.id)) {
                chatSessions.set(message.author.id, [
                    { role: 'system', content: systemPrompt }
                ]);
            }

            const history = chatSessions.get(message.author.id);
            history.push({ role: 'user', content: userInput });

            let aiResponse = await puter.ai.chat(history);
            let replyText = "";

            if (typeof aiResponse === 'string') replyText = aiResponse;
            else if (aiResponse?.message) replyText = aiResponse.message.content || aiResponse.message;
            else if (aiResponse?.text) replyText = aiResponse.text;
            else replyText = JSON.stringify(aiResponse);

            const searchMatch = replyText.match(/\[SEARCH:(.*?)\]/);
            replyText = replyText.replace(/\[SEARCH:(.*?)\]/g, "").trim();

            // Values for search parameters
            let searchEmbeds = [];
            let searchComponents = [];
            let searchResults = []; 
            let displayQuery = "";

            if (searchMatch) {
                console.log("Search command detected with parameters:", searchMatch[0]);
                // Search parameters 
                const params = searchMatch[1].split('|').map(s => s.trim());

                const getParam = (val) => (val === "" || val === "ANY" || val === "null") ? null : val;
                
                const searchParams = {
                    level_name: getParam(params[0]) || null,
                    level_id: getParam(params[1]) ? parseInt(getParam(params[1]), 10) : null,
                    artist: getParam(params[2]) || null,
                    charter: getParam(params[3]) || null,
                    difficulty: getParam(params[4]) || null,
                };

                console.log("Parsed search parameters:", searchParams);

                // When empty
                if (!searchParams.level_name && !searchParams.level_id && !searchParams.artist && !searchParams.difficulty && !searchParams.charter) {
                    console.log("Empty search parameters detected. Asking user for clarification.");
                    if (replyText === "") replyText = "What exactly are you looking for? Please provide a song name, artist name, or charter to search for.";
                } else {
                    // Get ALL result from TUF API based on the search parameters
                    searchResults = await level_search(searchParams);

                    let systemFeedback = "";
                    if (searchResults && searchResults.length > 0) {
                        // Add charter info
                        const topResults = searchResults.slice(0, 3).map((r, idx) => 
                            `#${idx + 1}. Song: ${r.song} by ${r.artist} (Map ID: ${r.id}), Charter: ${r.charter}, Difficulty: ${r.difficulty}, More info: https://tuforums.com/levels/${r.id}`
                        ).join('\n');
                        
                        systemFeedback = `The system found ${searchResults.length} matching levels. Here are the first 3:\n${topResults}`;

                        // Page display query
                        let queryParts = [];
                        if (searchParams.level_id) queryParts.push(`Map ID: ${searchParams.level_id}`);
                        if (searchParams.level_name) queryParts.push(`Name: ${searchParams.level_name}`);
                        if (searchParams.artist) queryParts.push(`Artist: ${searchParams.artist}`);
                        if (searchParams.charter) queryParts.push(`Charter: ${searchParams.charter}`);
                        if (searchParams.difficulty) queryParts.push(`Difficulty: ${searchParams.difficulty}`);
                        displayQuery = queryParts.join(' | ') || "All";

                        const totalPages = Math.ceil(searchResults.length / perPage);
                        searchEmbeds = [createEmbed(searchResults, displayQuery, 1, totalPages)];
                        searchComponents = [createButtons(1, totalPages)];

                    } else {
                        systemFeedback = `The system found no matching levels. Please tell the user.`;
                    }

                    history.push({ role: 'assistant', content: replyText });
                    history.push({ role: 'user', content: `(System hint: ${systemFeedback})` });

                    await message.channel.sendTyping();

                    let finalResponse = await puter.ai.chat(history);
                    if (typeof finalResponse === 'string') replyText = finalResponse;
                    else if (finalResponse?.message) replyText = finalResponse.message.content || finalResponse.message;
                    else if (finalResponse?.text) replyText = finalResponse.text;
                }
            }

            if (!replyText || replyText.trim() === "") {
                replyText = "I just don't have a response for that right now. Try asking something else or check your search query.";
            }

            history.push({ role: 'assistant', content: replyText });
            if (history.length > 15) history.splice(1, 2);

            // Send the reply with embeds and components if there are search results, otherwise just send the text
            const sentMessage = await message.reply({
                content: replyText,
                embeds: searchEmbeds.length > 0 ? searchEmbeds : undefined,
                components: searchComponents.length > 0 ? searchComponents : undefined
            });

            // Activate pagination if there are search results
            if (searchResults.length > 0) {
                let currentPage = 1;
                const totalPages = Math.ceil(searchResults.length / perPage);
                const collector = sentMessage.createMessageComponentCollector({ time: 120000 });

                collector.on('collect', async i => {
                    // Block users other than the original message author from using the buttons
                    if (i.user.id !== message.author.id) {
                        return i.reply({ content: "Hey! That's not for you.", ephemeral: true });
                    }

                    if (i.customId === 'prev') currentPage--;
                    if (i.customId === 'next') currentPage++;

                    await i.update({
                        embeds: [createEmbed(searchResults, displayQuery, currentPage, totalPages)],
                        components: [createButtons(currentPage, totalPages)]
                    });
                });

                // Disable buttons after timeout
                collector.on('end', () => {
                    sentMessage.edit({ components: [] }).catch(() => {});
                });
            }

        } catch (error) {
            console.error("Puter AI error:", error);
            if (error?.error?.message === 'moderation_failed' || error?.message.includes('moderation')) {
                const sassyResponses = [
                    "AYO CHILL!!! Let's keep it friendly! No need for that kind of language.😭",
                    "What the heck is wrong with you, mate? Can't you just be nice for once?😤",
                    "Got no life? Hiding behind a screen to throw insults? Pathetic.😒",
                    "Wow, I didn't know keyboard warriors were still a thing. Do you even have friends?😏",
                    "Can't believe you just like a loser. Do you even know how to have fun? Or are you just here to spread negativity?😔",
                ];
                const randomResponse = sassyResponses[Math.floor(Math.random() * sassyResponses.length)];
                message.reply(randomResponse);
            }
        }
    }
});

client.login(process.env.DISCORD_TOKEN);