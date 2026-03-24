const axios = require('axios');

async function level_search({ level_name = null, level_id = null, artist_name = null, charter = null, difficulty = null } = {}) {
    const headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36'
    };

    // Automatic ID Detection
    if (level_name && /^\d+$/.test(level_name) && !level_id) {
        level_id = parseInt(level_name, 10);
        level_name = null;
    }

    // 1. Search by ID
    if (level_id) {
        const apiUrl = `https://api.tuforums.com/v2/database/levels/${level_id}`;
        
        try {
            const response = await axios.get(apiUrl, { headers, timeout: 10000 });
            const rawData = response.data;
            
            // Handle both direct level object and wrapped result
            const item = rawData.result || rawData;

            if (!item || !item.id) {
                console.log("Level not found.");
                return [];
            }

            const diffObj = item.difficulty || {};
            
            return [{
                id: item.id || "Unknown Level ID",
                song: item.song || "Unknown Song",
                artist: item.artist || "Unknown Artist",
                charter: item.charter || "Unknown Charter",
                difficulty: diffObj.name || "Not Ranked",
                dl_link: item.dlLink || "No Download Link",
                video_link: item.videoLink || "No Video Link",
                workshop_link: item.workshopLink || "No Workshop Link"
            }];
        } catch (error) {
            console.error(`Error while calling TUF API: ${error.message}`);
            return [];
        }
    } 
    // 2. Search by Name, Artist, Charter or Difficulty
    else if (level_name || artist_name || charter || difficulty) {
        const apiUrl = "https://api.tuforums.com/v2/database/levels/";
        const searchQuery = level_name || artist_name || charter || difficulty || "";

        try {
            const response = await axios.get(apiUrl, {
                params: { query: searchQuery, limit: 100, offset: 0 },
                headers,
                timeout: 10000
            });

            const data = response.data;
            const levelList = [];

            if (data.results && data.results.length > 0) {
                for (const item of data.results) {
                    const itemArtist = item.artist || "Unknown Artist";
                    const itemCharter = item.charter || "Unknown Charter";
                    
                    const diffObj = item.difficulty || {};
                    const itemDiff = String(diffObj.name || "Not Ranked");

                    // Apply filters
                    if (artist_name && !itemArtist.toLowerCase().includes(artist_name.toLowerCase())) continue;
                    if (charter && !itemCharter.toLowerCase().includes(charter.toLowerCase())) continue;
                    if (difficulty && !itemDiff.toLowerCase().includes(String(difficulty).toLowerCase())) continue;

                    levelList.push({
                        id: item.id || "Unknown Level ID",
                        song: item.song || "Unknown Song",
                        artist: itemArtist,
                        charter: itemCharter,
                        difficulty: itemDiff,
                        dl_link: item.dlLink || "No Download Link",
                        video_link: item.videoLink || "No Video Link",
                        workshop_link: item.workshopLink || "No Workshop Link"
                    });
                }
                return levelList;
            } else {
                console.log("No levels found.");
                return [];
            }
        } catch (error) {
            console.error(`Error while calling TUF API: ${error.message}`);
            return [];
        }
    }
    return [];
}

module.exports = { level_search };