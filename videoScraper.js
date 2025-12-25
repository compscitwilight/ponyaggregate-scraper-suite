require("dotenv").config({ quiet: true });
const axios = require("axios");
const fs = require("node:fs");
const path = require("node:path");
const childProcess = require("node:child_process");

const processArg = process.argv[2];
if (processArg === "index") {
    const channelName = process.argv[3];
    if (!channelName)
        throw new Error("A valid channel_name must be provided");

    let outputLocation = process.argv[4];
    if (!outputLocation)
        throw new Error("A valid output_location must be provided");

    outputLocation = path.resolve(outputLocation);
    try {
        const stats = fs.statSync(outputLocation);
        if (!stats.isFile()) {
            console.error(`The output_location (${outputLocation}) must be a file`);
            return;
        }
    } catch {
        fs.writeFileSync(outputLocation, "");
    }

    (async function () {
        const channelVideosURL = new URL("https://www.googleapis.com/youtube/v3/channels");
        channelVideosURL.searchParams.set("key", process.env.GOOGLE_API_KEY);
        channelVideosURL.searchParams.set("part", "contentDetails");
        channelVideosURL.searchParams.set("forHandle", channelName);
        channelVideosURL.searchParams.set("maxResults", 1);
        const channelVideosResponse = await axios({ url: channelVideosURL });
        if (channelVideosResponse.status !== 200)
            throw new Error("Failed to retrieve channel content details");

        const uploadsPlaylistID = channelVideosResponse.data.items[0].contentDetails.relatedPlaylists.uploads;
        console.log(uploadsPlaylistID);
        const videoIds = new Array();
        async function getPlaylistItems(nextPageToken) {
            const uploadsPlaylistURL = new URL("https://www.googleapis.com/youtube/v3/playlistItems");
            uploadsPlaylistURL.searchParams.set("key", process.env.GOOGLE_API_KEY);
            uploadsPlaylistURL.searchParams.set("part", "contentDetails");
            uploadsPlaylistURL.searchParams.set("maxResults", 50);
            if (nextPageToken) uploadsPlaylistURL.searchParams.set("pageToken", nextPageToken);
            uploadsPlaylistURL.searchParams.set("playlistId", uploadsPlaylistID);
            const uploadsPlaylistResponse = await axios({ url: uploadsPlaylistURL });
            for (const playlistItem of uploadsPlaylistResponse.data.items) {
                const videoId = playlistItem.contentDetails.videoId;
                const videoDataURL = new URL("https://www.googleapis.com/youtube/v3/videos");
                videoDataURL.searchParams.set("key", process.env.GOOGLE_API_KEY);
                videoDataURL.searchParams.set("part", "snippet");
                videoDataURL.searchParams.set("id", videoId);
                try {
                    console.log(videoIds.length);
                    const videoDataResponse = await axios({ url: videoDataURL });
                    const data = videoDataResponse.data.items[0].snippet;
                    const thumbnailUrl = Object.values(data.thumbnails).reduce((max, current) => {
                        return (current.width * current.height) > (max.width * max.height) ? current : max;
                    }).url
                    const thumbnailResponse = await fetch(thumbnailUrl);
                    const thumbnailBuffer = Buffer.from(await thumbnailResponse.bytes());
                    videoIds.push({
                        canonicalId: videoId,
                        submission: {
                            name: data.title,
                            description: data.description,
                            source: `https://youtube.com/watch?v=${videoId}`,
                            rating: "Safe",
                            thumbnailMime: thumbnailResponse.status === 200 ? thumbnailResponse.headers.get("Content-Type") : undefined,
                            thumbnail: thumbnailResponse.status === 200 ? `data:${thumbnailResponse.headers.get("Content-Type")};base64,${thumbnailBuffer.toString('base64')}` : undefined,
                            tags: [
                                new Date(Date.parse(data.publishedAt)).getFullYear().toString(),
                                ...(data.tags || []),
                                "imported from youtube",
                                "automated"
                            ],
                            creator: data.channelTitle,
                            submissionType: "Animation",
                            originalDate: Date.parse(data.publishedAt)
                        }
                    });
                } catch (error) {
                    console.log(error);
                    console.log(`Failed to retrieve data for video with ID ${videoId}`);
                }
            }

            if (uploadsPlaylistResponse.data.nextPageToken) await getPlaylistItems(uploadsPlaylistResponse.data.nextPageToken);
        }

        await getPlaylistItems();
        console.log(`Scraped metadata for ${videoIds.length} videos`);
        fs.writeFileSync(outputLocation, JSON.stringify(videoIds));
    })();
} else if (processArg === "download") {
    let metadataLocation = process.argv[3]
    if (!metadataLocation)
        throw new Error("A valid metadata_file argument must be provided");

    metadataLocation = path.resolve(metadataLocation);
    try {
        const stats = fs.statSync(metadataLocation);
        if (!stats.isFile()) {
            console.error(`The metadata_file provided (${metadataLocation}) must be a valid file`);
            return;
        }
    } catch {
        throw new Error(`The metadata file (${metadataLocation}) could not be found`);
    }

    let outputLocation = process.argv[4];
    if (!outputLocation)
        throw new Error("A valid output_location argument must be provided");

    outputLocation = path.resolve(outputLocation);
    (async function () {
        try {
            const stats = fs.statSync(outputLocation);
            if (stats.isFile()) {
                console.error(`The output_location provided (${outputLocation}) must be a directory`);
                return;
            }
        } catch {
            fs.mkdirSync(outputLocation);
            console.log(`Created ${outputLocation} directory for yt-dlp output`);
        }

        const outputJson = fs.readFileSync(metadataLocation);
        const json = JSON.parse(outputJson);

        for (const entry of json) {
            const canonicalId = entry.canonicalId;
            console.log(`Got canonical ID ${canonicalId}`);

            try {
                fs.readFileSync(path.join(outputLocation, entry.submission.name));
                console.log(`Skipped ${entry.canonicalId} as it was already downloaded`);
                continue;
            } catch {
                const source = entry.submission.source;
                console.log(`Starting video download at ${source}`);
                try {
                    const start = Date.now();
                    const dlpProcess = childProcess.spawnSync(
                        "yt-dlp",
                        [source, "-o", entry.submission.name, "-t", "mp4", "--cookies-from-browser", "firefox"],
                        { cwd: outputLocation }
                    );
                    console.log(dlpProcess.output.toString());
                    console.log(`took ${Date.now() - start}ms`);
                } catch (error) {
                    console.log(error);
                    console.log(`Failed to execute yt-dlp for video ${canonicalId}`);
                }
            }
        }

        console.log("Video downloads complete");
    })();
} else if (processArg === "upload") {
    if (!process.env.PA_API_KEY) throw new Error("A PA_API_KEY must be configured in your .env");

    let outputLocation = process.argv[3];
    if (!outputLocation)
        throw new Error("A valid output_file argument must be provided");

    outputLocation = path.resolve(outputLocation);
    try {
        const stats = fs.statSync(outputLocation);
        if (!stats.isFile()) {
            console.error(`The output_file provided (${outputLocation}) must be a file`);
            return;
        }
    } catch {
        throw new Error(`The output file (${outputLocation}) could not be found`);
    }

    let videosLocation = process.argv[4];
    if (!videosLocation)
        throw new Error("A valid videos_location argument must be provided");

    videosLocation = path.resolve(videosLocation);
    try {
        const stats = fs.statSync(videosLocation);
        if (!stats.isDirectory()) {
            console.error(`The videos_location argument (${videosLocation}) provided must be a directory`);
            return;
        }
    } catch {
        throw new Error(`The videos directory (${videosLocation}) could not be found`);
    }

    const exclusionList = process.argv[5];
    (async function () {
        const outputJson = fs.readFileSync(outputLocation);
        const json = JSON.parse(outputJson);

        const videosUploaded = new Array();
        for (const entry of json) {
            if (exclusionList && exclusionList.includes(entry.canonicalId)) {
                console.log(`Found ${entry.canonicalId} in the exclusion list, skipping...`);
                continue;
            }

            try {
                const video = fs.readFileSync(path.join(videosLocation, entry.submission.name));
                const attachmentResponse = await fetch("https://ponyaggregate.com/api/attachments/create", {
                    method: "POST",
                    headers: {
                        "Authorization": `Bearer ${process.env.PA_API_KEY}`
                    },
                    body: JSON.stringify({
                        name: entry.submission.name,
                        mime: "video/mp4",
                        size: video.byteLength
                    })
                });
                if (!attachmentResponse.ok) {
                    console.warn(`Failed to generate presigned URL for video with canon ID ${entry.canonicalId}: ${attachmentResponse.statusText}: ${attachmentResponse.status}`);
                    continue;
                }

                const { presignedUrl, uuid } = await attachmentResponse.json();
                console.log(`retrieved presigned URL ${presignedUrl} with UUID ${uuid}`);

                const uploadResponse = await fetch(presignedUrl, {
                    method: "PUT",
                    headers: {
                        "Content-Type": "video/mp4",
                        "Content-Length": Buffer.from(video).length
                    },
                    body: video
                });

                if (!uploadResponse.ok) {
                    console.warn(`Failed to upload video with attachment ID \`${uuid}\`: ${uploadResponse.status}`);
                    continue;
                }

                const finalizeResponse = await fetch(`https://ponyaggregate.com/api/attachments/${uuid}/finalize`, {
                    method: "PUT",
                    headers: { "Authorization": `Bearer ${process.env.PA_API_KEY}` }
                });

                if (!finalizeResponse.ok) {
                    console.warn(`Failed to finalize attachment with UUID ${uuid}: ${finalizeResponse.status}`);
                    continue;
                }

                const submissionResponse = await fetch("https://ponyaggregate.com/api/submissions/new", {
                    method: "POST",
                    headers: { "Authorization": `Bearer ${process.env.PA_API_KEY}` },
                    body: JSON.stringify({
                        ...entry.submission,
                        attachments: [uuid]
                    })
                });

                if (!submissionResponse.ok) {
                    console.log(`Failed to create new submission for video ${entry.submission.name}: ${submissionResponse.status}`);
                    continue;
                }

                console.log(`Successfully created submission for video ${entry.submission.name}`);
                videosUploaded.push(entry.canonicalId);
            } catch (error) {
                console.log(`video file not found!: ${entry.submission.name}. skipping for now`, error);
            }
            console.log();
            await new Promise((resolve) => setTimeout(resolve, 1000)); // delay 1s
        }
        console.log(`uploaded ${videosUploaded.join(",")} (${videosUploaded.length} total)`);
    })();
} else {
    console.log("Invalid argument provided");
    console.log("   node videoScraper.js");
    console.log("       index [channel_name] - Indexes all videos on the specified channel name and creates a JSON file containing structured metadata for each");
    console.log("       download - Downloads all the videos based on the \`canonicalId\` located in each entry of the output.json file");
    console.log("       upload [exclusion_list] - Uploads all the videos along with their structured metadata to PonyAggregate (be sure to supply a valid PonyAggregate API key in your environment variables). Skips over entries with a canonical ID included in the exclusion list.");
}