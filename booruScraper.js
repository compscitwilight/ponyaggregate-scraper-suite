require("dotenv").config({ quiet: true });

const SUPPORTED_BOORUS = ["derpibooru", "manebooru", "ponerpics", "twibooru"];
const BOORU_IMAGE_URLS = {
    "derpibooru": "https://derpibooru.org/images/",
    "manebooru": "https://manebooru.art/images/",
    "ponerpics": "https://ponerpics.org/images/",
    "twibooru": "https://twibooru.org/"
}

const BOORU_ENDPOINTS = {
    "derpibooru": "https://derpibooru.org/api/v1/json/search/images",
    "manebooru": "https://manebooru.art/api/v1/json/search/images",
    "ponerpics": "https://ponerpics.org/api/v1/json/search/images",
    "twibooru": "https://twibooru.org/api/v3/search/posts"
}

const BOORU_PER_PAGE_LIMITS = {
    "derpibooru": 50,
    "manebooru": 50,
    "ponerpics": 50,
    "twibooru": 15
}

const BOORU_RATE_LIMIT_REQUESTS = {
    "derpibooru": 20,
    "manebooru": 20,
    "ponerpics": 20,
    "twibooru": 10
}

// in seconds
const BOORU_RATE_LIMIT_INTERVALS = {
    "derpibooru": 10, // https://derpibooru.org/pages/api#ratelimits
    "manebooru": 10,
    "ponerpics": 10,
    "twibooru": 60 // https://twibooru.org/pages/api#rate-limits
}

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { pipeline } = require("node:stream/promises");
const { Readable } = require("node:stream");

let arg = process.argv[2];
if (!arg)
    throw new Error("An operation must be specified");
arg = arg.toLowerCase();

if (arg === "index") {
    let booru = process.argv[3];
    if (!booru)
        throw new Error(`A supported ponybooru must be specified (${SUPPORTED_BOORUS.join(" | ")})`);
    booru = booru.toLowerCase();

    if (!SUPPORTED_BOORUS.includes(booru.toLowerCase()))
        throw new Error(`An unsupported ponybooru was specified (examples: ${SUPPORTED_BOORUS.join(", ")})`);

    const queryString = process.argv[4];
    if (!queryString)
        throw new Error("A valid query string must be provided");

    let maxImages = process.argv[5];
    if (!maxImages)
        throw new Error("A valid max_images argument must be provided (1-10,000)");

    maxImages = parseInt(maxImages);
    if (Number.isNaN(maxImages))
        throw new Error(`Invalid max_images argument provided (${maxImages})`);

    let outputLocation = process.argv[6];
    if (!outputLocation)
        throw new Error("A valid output_location argument must be provided");

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

    const results = new Array();
    (async function () {
        const BOORU_API_KEY = booru === "derpibooru" ? process.env.DERPIBOORU_API_KEY :
            booru === "manebooru" ? process.env.MANEBOORU_API_KEY :
                booru === "ponerpics" ? process.env.PONERPICS_API_KEY :
                    booru === "twibooru" && process.env.TWIBOORU_API_KEY;

        if (BOORU_API_KEY) console.log(`Found API key for ${booru} in .env`);

        let requests = 0;
        let windowStart = Date.now();

        let currentPage = 1;
        const pages = Math.max(1, Math.ceil(maxImages / BOORU_PER_PAGE_LIMITS[booru]));

        const searchEndpoint = new URL(BOORU_ENDPOINTS[booru]);
        if (BOORU_API_KEY) searchEndpoint.searchParams.set("key", BOORU_API_KEY);
        searchEndpoint.searchParams.set("q", queryString);
        searchEndpoint.searchParams.set("per_page", maxImages < BOORU_PER_PAGE_LIMITS[booru] ? maxImages : BOORU_PER_PAGE_LIMITS[booru]);
        searchEndpoint.searchParams.set("page", currentPage);
        console.log(searchEndpoint.toString());
        console.log(`pages: ${pages}`);
        while (currentPage <= pages) {
            console.log(`current page: ${currentPage}`);
            const now = Date.now();
            if (now - windowStart >= BOORU_RATE_LIMIT_INTERVALS[booru]) {
                windowStart = now;
                requests = 0;
            }

            if (requests >= BOORU_RATE_LIMIT_REQUESTS[booru]) {
                const sleepMs = BOORU_RATE_LIMIT_REQUESTS[booru] - (now - windowStart);
                await (new Promise((resolve) => setTimeout(resolve, sleepMs)));
                continue;
            }

            requests++;

            searchEndpoint.searchParams.set("page", currentPage);
            const response = await fetch(searchEndpoint);

            if (response.status === 429) {
                console.log(`Being rate limited, waiting ${BOORU_RATE_LIMIT_INTERVALS[booru]}ms before retrying...`);
                await (new Promise((resolve) => setTimeout(resolve, BOORU_RATE_LIMIT_INTERVALS[booru])));
                continue;
            }

            if (!response.ok) {
                throw new Error(`HTTP Status ${response.status}`);
            }

            const data = await response.json();
            const entries = booru === "twibooru" ? data.pages : data.images;
            for (const entry of entries) {
                // console.log(entry.tags.map((t) => t.match(/artist:.*$/)));
                results.push({
                    canonicalId: entry.id,
                    canonicalFormat: entry.format,
                    canonicalMime: entry.mime_type,
                    canonicalSize: entry.size,
                    viewUrl: entry.view_url,
                    submission: {
                        name: entry.name,
                        description: entry.description,
                        tags: entry.tags,
                        source: `${BOORU_IMAGE_URLS[booru]}${entry.id}`,
                        rating: entry.tags.includes("safe") ? "Safe" :
                            entry.tags.includes("suggestive") ? "Suggestive" :
                                (entry.tags.includes("grimdark") || entry.tags.includes("explicit")) && "Mature",
                        creator: entry.tags
                            .map((t) => t.match(/artist:(.*)$/))
                            .filter(Boolean)
                            .map((a) => a[1])
                            .join(","),
                        submissionType: (!entry.animated && entry.mime_type.includes("image/")) ? "Artwork" : "Video",
                        originalDate: Date.parse(entry.first_seen_at)
                    }
                });
            }
            currentPage++;
        }

        fs.writeFileSync(outputLocation, JSON.stringify({
            booru,
            timestamp: Date.now(),
            resultCount: results.length,
            checksum: crypto.createHash("md5").update(JSON.stringify(results)).digest("hex"),
            results
        }));
    })();
    return;
} else if (arg === "download") {
    let metadataFile = process.argv[3];
    if (!metadataFile)
        throw new Error("A valid metadata_file argument must be provided");
    metadataFile = path.resolve(metadataFile);

    try {
        const stats = fs.statSync(metadataFile);
        if (!stats.isFile()) {
            console.error(`The metadata_file (${metadataFile}) must be a file`);
            return;
        }
    } catch {
        throw new Error(`${metadataFile} could not be found`);
    }

    let outputDirectory = process.argv[4];
    if (!outputDirectory)
        throw new Error("A valid output_directory argument must be provided");
    outputDirectory = path.resolve(outputDirectory);

    try {
        const stats = fs.statSync(outputDirectory);
        if (!stats.isDirectory()) {
            console.error(`The output_directory (${outputDirectory}) must be a directory`);
            return;
        }
    } catch {
        fs.mkdirSync(outputDirectory);
    }

    (async function () {
        const entriesRaw = fs.readFileSync(metadataFile);
        const entriesJson = JSON.parse(entriesRaw);

        if (!SUPPORTED_BOORUS.includes(entriesJson.booru))
            throw new Error(`Unsupported ponybooru detected (got ${entriesJson.booru})`);

        let index = 1;
        for (const entry of entriesJson.results) {
            if (index % BOORU_RATE_LIMIT_REQUESTS[entriesJson.booru] === 0) {
                const intervalMs = BOORU_RATE_LIMIT_INTERVALS[entriesJson.booru] * 1000;
                console.log(`Timing out for ${intervalMs}ms to avoid rate-limits`);
                await (new Promise((resolve) => setTimeout(resolve, intervalMs)));
            }

            const viewURL = entry.viewUrl;
            const fileName = `${entry.canonicalId}.${entry.canonicalFormat}`;
            const imageFilePath = path.join(outputDirectory, fileName);
            try {
                if (fs.statSync(imageFilePath)) {
                    console.log(`Skipping ${fileName} as it has already been downloaded`);
                    continue;
                }
            } catch {
                const writeStream = fs.createWriteStream(imageFilePath);
                const downloadStart = Date.now();
                const response = await fetch(viewURL);
                if (!response.ok) {
                    console.error(`Failed to download image ${fileName}: Status code ${response.status}`);
                    continue;
                }

                pipeline(
                    Readable.fromWeb(response.body),
                    writeStream
                );

                console.log(`Finished downloading "${fileName}" (${index}/${entriesJson.resultCount}) in ${Date.now() - downloadStart}ms`);
                index++;
            }
        }
    })();
} else if (arg === "upload") {
    if (!process.env.PA_API_KEY) throw new Error("A PA_API_KEY must be configured in your .env");

    let outputFile = process.argv[3];
    if (!outputFile)
        throw new Error("A valid output_file argument must be provided");

    outputFile = path.resolve(outputFile);
    try {
        const stats = fs.statSync(outputFile);
        if (!stats.isFile()) {
            console.error(`The output_file (${outputFile}) must be a file`);
            return;
        }
    } catch {
        throw new Error(`${outputFile} could not be found`);
    }

    let imagesDirectory = process.argv[4];
    if (!imagesDirectory)
        throw new Error("A valid images_directory argument must be provided");

    imagesDirectory = path.resolve(imagesDirectory);
    try {
        const stats = fs.statSync(imagesDirectory);
        if (!stats.isDirectory()) {
            console.error(`The images_directory (${imagesDirectory}) must be a directory`);
            return;
        }
    } catch {
        throw new Error(`${imagesDirectory} could not be found`);
    }

    (async function () {
        const entriesRaw = fs.readFileSync(outputFile);
        const entriesJson = JSON.parse(entriesRaw);

        let index = 1;
        for (const entry of entriesJson.results) {
            const startTime = Date.now();
            const imagePath = path.join(imagesDirectory, `${entry.canonicalId}.${entry.canonicalFormat}`);
            const imageContents = fs.readFileSync(imagePath);
            const sum = crypto.createHash("md5").update(imageContents).digest("hex");

            const duplicateCheckResponse = await fetch(`https://ponyaggregate.com/api/attachments/check/${sum}`);
            const { exists } = await duplicateCheckResponse.json();
            if (exists) {
                console.log(`Skipping image ${entry.submission.name} (MD5: ${sum}) as it has already been published to PonyAggregate.`);
                continue;
            }

            const newAttachmentResponse = await fetch("https://ponyaggregate.com/api/attachments/create", {
                method: "POST",
                headers: { "Authorization": `Bearer ${process.env.PA_API_KEY}` },
                body: JSON.stringify({
                    name: entry.submission.name,
                    mime: entry.canonicalMime,
                    size: entry.canonicalSize
                })
            });

            if (!newAttachmentResponse.ok) {
                console.warn(`Failed to create attachment for image ${entry.submission.name}: Status code ${newAttachmentResponse.status}`);
                continue;
            }

            const { presignedUrl, uuid } = await newAttachmentResponse.json();
            const uploadResponse = await fetch(presignedUrl, {
                method: "PUT",
                headers: {
                    "Content-Type": entry.canonicalMime,
                    "Content-Length": Buffer.from(imageContents).length
                },
                body: imageContents
            });

            if (!uploadResponse.ok) {
                console.warn(`Failed to upload image ${entry.submission.name}: Status code ${uploadResponse.status}`);
                continue;
            }

            const finalizeResponse = await fetch(`https://ponyaggregate.com/attachments/${uuid}/finalize`, {
                method: "PUT",
                headers: { "Authorization": `Bearer ${process.env.PA_API_KEY}` }
            });

            if (!finalizeResponse.ok) {
                console.warn(`Failed to finalize image upload for ${entry.submission.name}: Status code ${finalizeResponse.status}`);
                continue;
            }

            const submissionResponse = await fetch("https://ponyaggregate.com/api/submissions/new", {
                method: "POST",
                headers: { "Authorization": `Bearer ${process.env.PA_API_KEY}` },
                body: JSON.stringify({
                    ...entry.submission,
                    thumbnailMime: entry.canonicalMime,
                    thumbnail: `data:${entry.canonicalMime};base64,${Buffer.from(imageContents).toString("base64")}`
                })
            });

            if (!submissionResponse.ok) {
                console.warn(`Failed to create submission for ${entry.submission.name}: Status code ${submissionResponse.status}`);
                continue;
            }

            console.log(`Successfully created submission for ${entry.submission.name} (${index}/${entriesJson.resultCount}), took ${Date.now() - startTime}ms`);
            console.log();
            index++;
        }
    })();
}