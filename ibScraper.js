require("dotenv").config({ quiet: true });

const SUPPORTED_IMAGEBOARDS = ["4chan", "nhnb", "mlpol", "ponychan"];
const SUPPORTED_BOARDS = {
    "4chan": ["mlp"],
    "nhnb": ["fim", "clop", "qa"]
}

const fs = require("node:fs");
const path = require("node:path");
const { pipeline } = require("node:stream/promises");
const { Readable } = require("node:stream");
const JSZip = require("jszip");

const arg = process.argv[2];
if (!arg)
    throw new Error("An operation must be specified");

if (arg.toLowerCase() === "scrape") {
    let imageboard = process.argv[3];
    if (!imageboard) throw new Error("An imageboard argument is required");
    imageboard = imageboard.toLowerCase();
    if (!SUPPORTED_IMAGEBOARDS.includes(imageboard))
        throw new Error(`Unsupported or unknown imageboard site specified (${imageboard})`);

    let board = process.argv[4];
    if (!board) throw new Error("A board argument is required");
    board = board.toLowerCase();
    if (!SUPPORTED_BOARDS[imageboard].includes(board))
        throw new Error(`Unsupported or unknown board specified (${board})`);

    let outputLocation = process.argv[5];
    if (!outputLocation) throw new Error("An output location argument is required");
    outputLocation = path.resolve(outputLocation);

    try {
        const stats = fs.statSync(outputLocation);
        if (!stats.isDirectory()) {
            console.error(`Output location specified (${outputLocation}) must be a directory`);
            return;
        }
    } catch {
        fs.mkdirSync(outputLocation);
    }

    (async function () {
        const imagesDirectory = path.join(outputLocation, "images");
        if (!fs.existsSync(imagesDirectory)) fs.mkdirSync(imagesDirectory);

        const boardsDirectory = path.join(outputLocation, "boards");
        if (!fs.existsSync(boardsDirectory)) fs.mkdirSync(boardsDirectory);

        const boardDirectory = path.join(boardsDirectory, board);
        if (!fs.existsSync(boardDirectory)) fs.mkdirSync(boardDirectory);

        if (imageboard === "4chan") {
            const boardsResponse = await fetch("https://a.4cdn.org/boards.json", { method: "GET" });
            if (!boardsResponse.ok) throw new Error(`Failed to retrieve boards from 4chan: Status code ${boardsResponse.status}`);
            const { boards } = await boardsResponse.json();
            const { pages } = boards.find((b) => b.board === board);
            for (var i = 0; i < pages; i++) {
                console.log(`Requesting page ${i + 1}/${pages} from /${board}/`);
                const pageResponse = await fetch(`https://a.4cdn.org/${board}/${i + 1}.json`, { method: "GET" });
                if (pageResponse.status !== 200) throw new Error(`Failed to retrieve page ${i + 1} of ${board}: Status code ${boardsResponse.status}`);
                const { threads } = await pageResponse.json();
                const ops = threads.map((t) => t.posts[0].no);
                console.log(`Got ${ops.length} threads from page ${i + 1}`);

                for (const op of ops) {
                    const threadFilePath = path.join(boardDirectory, `thread-${op}.json`);
                    // if (fs.existsSync(threadFilePath)) continue;
                    const postsResponse = await fetch(`https://a.4cdn.org/${board}/thread/${op}.json`, { method: "GET" });
                    console.log(`Requesting thread #${op}`);
                    if (postsResponse.status !== 200) throw new Error(`Failed to retrieve posts for OP ${op}: Status code ${postsResponse.status}`);

                    const { posts } = await postsResponse.json();
                    console.log(`Got ${posts.length} posts from #${op}`);

                    let index = 0;
                    const thread = new Array();
                    for (let post of posts) {
                        if (post.filename) {
                            console.log(`Requesting asset for #${op}->${post.no}`);
                            const fileResponse = await fetch(`https://i.4cdn.org/${board}/${post.tim}${post.ext}`);
                            if (!fileResponse.ok) throw new Error(`Failed to retrieve file for post ${post.no}: Status code ${fileResponse.status}`);
                            const filePath = path.join(imagesDirectory, `${post.tim}${post.ext}`);
                            if (fs.existsSync(filePath)) continue;
                            console.log(`Got asset for #${op}->${post.no}`);

                            const writeStream = fs.createWriteStream(filePath);
                            try {
                                pipeline(Readable.fromWeb(fileResponse.body), writeStream);
                                post.localAsset = `${post.tim}${post.ext}`;
                            } catch (error) {
                                console.warn(`Failed to retrieve asset for thread #${post.no}: ${error}`);
                            }
                        }
                        thread.push(post);
                        index++;
                        console.log(`Saved post in memory (${index}/${posts.length})`);
                    }
                    fs.writeFileSync(threadFilePath, JSON.stringify(thread));
                    console.log(`Saved thread #${op} successfully`);
                }
            }
        } else if (imageboard === "nhnb") {
            const boardResponse = await fetch(`https://nhnb.org/${board}/1.json`, { method: "GET" });
            if (boardResponse.status !== 200) throw new Error(`Failed to retrieve board information: Status code ${boardResponse.status}`);
            const { pageCount } = await boardResponse.json();

            for (let i = 0; i < pageCount; i++) {
                console.log(`Requesting page ${i + 1}/${pageCount} from /${board}/`);
                const pageResponse = await fetch(`https://nhnb.org/${board}/${i + 1}.json`, { method: "GET" });
                if (pageResponse.status !== 200) throw new Error(`Failed to retrieve page threads: Status code ${pageResponse.status}`);
                const { threads } = await pageResponse.json();
                const threadIds = threads.map((t) => t.threadId);
                console.log(`Got ${threadIds.length} threads from page ${i + 1}`);

                for (const threadId of threadIds) {
                    const threadFilePath = path.join(boardDirectory, `thread-${threadId}.json`);
                    console.log(`Requesting thread #${threadId}`);
                    const threadResponse = await fetch(`https://nhnb.org/${board}/res/${threadId}.json`, { method: "GET" });
                    if (threadResponse.status !== 200) throw new Error(`Failed to retrieve thread: Status code ${threadResponse.status}`);
                    const threadJson = await threadResponse.json();
                    const opPost = {
                        name: threadJson.name,
                        signedRole: threadJson.signedRole,
                        email: threadJson.email,
                        id: threadJson.id,
                        subject: threadJson.subject,
                        markdown: threadJson.markdown,
                        message: threadJson.message,
                        threadId: threadJson.threadId,
                        creation: threadJson.creation,
                        files: threadJson.files
                    };
                    console.log(`Got ${threadJson.posts.length + 1} posts from #${threadId}`);

                    const thread = new Array();
                    for (const post of [opPost, ...threadJson.posts]) {
                        if (post.files.length > 0) {
                            console.log(`Requesting ${post.files.length} assets for post`);
                            for (let file of post.files) {
                                const assetUrl = new URL("https://nhnb.org");
                                assetUrl.pathname = file.path;
                                const assetResponse = await fetch(assetUrl, { method: "GET" });
                                if (assetResponse.status !== 200) throw new Error(`Failed to retrieve asset at ${assetUrl}: Status code ${assetResponse.status}`);

                                const assetHash = assetUrl.pathname.split("/")[2];
                                const filePath = path.join(imagesDirectory, assetHash);
                                try {
                                    if (!fs.existsSync(filePath)) {
                                        const writeStream = fs.createWriteStream(filePath);
                                        pipeline(Readable.fromWeb(assetResponse.body), writeStream);
                                    }
                                    if (!post.localAsset) post.localAsset = new Array();
                                    post.localAsset.push(assetHash);
                                } catch (error) {
                                    console.warn(`Failed to download asset ${file.name}: ${error}`);
                                }
                            }
                        }
                        thread.push(post);
                    }

                    fs.writeFileSync(threadFilePath, JSON.stringify(thread));
                    console.log(`Saved thread #${threadId} successfully`);
                }
            }
        }
    })();
} else if (arg.toLowerCase() === "zip") {
    let outputDirectory = process.argv[3];
    if (!outputDirectory) throw new Error("An output_directory argument is required");
    outputDirectory = path.resolve(outputDirectory);
    try {
        const stats = fs.statSync(outputDirectory);
        if (!stats.isDirectory()) {
            console.error(`The output_directory (${outputDirectory}) specified must be a directory`);
            return;
        }
    } catch {
        throw new Error(`The output_directory (${outputDirectory}) does not exist`);
    }

    const slug = process.argv[4];
    if (!slug) throw new Error("A slug argument is required");
    const [board, thread] = slug.split("/");
    if (!board) throw new Error("A board must be part of the slug argument");

    let outputZip = process.argv[5];
    if (!outputZip) throw new Error("An output_zip argument is required");
    outputZip = path.resolve(outputZip);
    try {
        const stats = fs.statSync(outputZip);
        if (!stats.isFile()) {
            console.error(`The output_zip (${outputZip}) specified must be a file`);
            return;
        }
    } catch {
        if (path.extname(outputZip) !== ".zip") outputZip = outputZip.concat(".zip");
        fs.writeFileSync(outputZip, "");
    }

    function writeImageToArchive(archiveImagesDirectory, assetName) {
        const localAssetPath = path.join(outputDirectory, "images", assetName);
        if (!fs.existsSync(localAssetPath)) {
            console.warn(`Failed to archive ${assetName}, file not found at ${localAssetPath}`);
            return;
        }

        const assetBytes = fs.readFileSync(localAssetPath);
        archiveImagesDirectory.file(assetName, Buffer.from(assetBytes));
    }

    if (thread) {
        const threadMetadataPath = path.join(outputDirectory, "boards", board, `thread-${thread}.json`);
        if (!fs.existsSync(threadMetadataPath)) throw new Error(`A metadata file could not be found at ${threadMetadataPath}`);

        const threadMetadataRaw = fs.readFileSync(threadMetadataPath);
        const threadMetadataJSON = JSON.parse(threadMetadataRaw);
        const zip = new JSZip();
        const zipImagesDirectory = zip.folder("images");

        const localAssets = threadMetadataJSON.filter((p) => p.localAsset).map((p) => p.localAsset);
        for (const asset of localAssets) writeImageToArchive(zipImagesDirectory, asset)

        zip.file("thread.json", Buffer.from(threadMetadataRaw));
        zip.generateAsync({ type: "arraybuffer" }).then((content) => {
            fs.writeFileSync(outputZip, Buffer.from(content));
            console.log(`Archived thread #${thread} at ${outputZip}, containing ${localAssets.length} assets and ${threadMetadataJSON.length} posts.`);
        })
    } else {
        const boardDirectoryPath = path.join(outputDirectory, "boards", board);
        if (!fs.existsSync(boardDirectoryPath)) throw new Error(`The board directory could not be found at ${boardDirectoryPath}`);

        const threads = fs.readdirSync(boardDirectoryPath);
        const zip = new JSZip();
        const zipImagesDirectory = zip.folder("images");
        const zipThreadsDirectory = zip.folder("threads");
        for (const thread of threads) {
            console.log(thread);
            const fullThreadPath = path.join(boardDirectoryPath, thread);
            const threadBytes = fs.readFileSync(fullThreadPath);
            const threadJson = JSON.parse(threadBytes);
            zipThreadsDirectory.file(thread, Buffer.from(threadBytes));
            for (const post of threadJson) {
                const localAsset = post.localAsset;
                if (localAsset)
                    if (Array.isArray(localAsset))
                        for (const asset of localAsset) writeImageToArchive(zipImagesDirectory, asset);
                    else writeImageToArchive(zipImagesDirectory, localAsset);
            }
        }

        zip.generateAsync({ type: "arraybuffer" }).then((content) => {
            fs.writeFileSync(outputZip, Buffer.from(content));
            console.log(`Archived board ${board} at ${outputZip}, containing ${threads.length} threads`);
        })
    }
}