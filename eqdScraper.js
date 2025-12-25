require("dotenv").config({ quiet: true });

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const cheerio = require("cheerio");

const MONTH_REGEXP = /^(\d{2})-(\d{4})$/;

const arg = process.argv[2];
if (!arg)
    throw new Error("An operation must be specified");

if (arg.toLowerCase() === "index") {
    const start = process.argv[3];
    if (!start) throw new Error("Missing start month argument");
    const startMatch = MONTH_REGEXP.exec(start);
    if (!startMatch) throw new Error("Invalid start argument provided (must be of form MM-YYYY)");
    const startDate = new Date();
    startDate.setFullYear(startMatch[2], startMatch[1] - 1, 1);
    startDate.setHours(0, 0, 0, 0);

    const end = process.argv[4];
    if (!end) throw new Error("Missing end month argument");
    const endMatch = MONTH_REGEXP.exec(end);
    if (!endMatch) throw new Error("Invalid end argument provided (must be of form MM-YYYY)");
    const endDate = new Date();
    endDate.setFullYear(endMatch[2], endMatch[1] - 1, 1);
    endDate.setHours(0, 0, 0, 0);

    if ((startMatch[2] > endMatch[2]) ||
        (startMatch[2] === endMatch[2] && (endMatch[1] - startMatch[1]) < 1)
    ) throw new Error(`Invalid time range specified (end month must come before start month, and interval must be at least 1 month). Got ${startMatch[1]}/${startMatch[2]}-${endMatch[1]}/${endMatch[2]}`);

    let outputLocation = process.argv[5];
    if (!outputLocation) throw new Error("Missing required metadata_output_location argument");
    outputLocation = path.resolve(outputLocation);

    try {
        const stats = fs.statSync(outputLocation);
        if (!stats.isDirectory()) {
            console.error(`Output location (${outputLocation}) is not a directory`);
            return;
        }
    } catch {
        fs.mkdirSync(outputLocation);
    }

    (async function () {
        console.log(startDate);
        const rangeArchiveDirectoryPath = path.join(outputLocation, `${startDate.getFullYear()}_${startDate.getMonth() + 1}-${endDate.getFullYear()}_${endDate.getMonth() + 1}`);
        if (!fs.existsSync(rangeArchiveDirectoryPath)) fs.mkdirSync(rangeArchiveDirectoryPath);

        while (startDate.getTime() !== endDate.getTime()) {
            startDate.setDate(startDate.getDate() + 1);
            await (new Promise((resolve) => setTimeout(resolve, 250)));
            const month = startDate.getMonth() + 1;
            const sourceUrl = `https://equestriadaily.com/${startDate.getFullYear()}_${month}_${startDate.getDate() < 10 ? `0${startDate.getDate()}` : startDate.getDate()}_archive.html`;
            const archivePath = path.join(rangeArchiveDirectoryPath, `archive_${startDate.getFullYear()}_${month}_${startDate.getDate()}`);
            try {
                fs.statSync(archivePath);
                console.log(`Skipping ${sourceUrl}`);
                continue;
            } catch { fs.mkdirSync(archivePath); }

            const response = await fetch(sourceUrl);
            if (!response.ok) continue;
            const htmlBytes = await response.bytes();
            const dayParser = cheerio.loadBuffer(Buffer.from(htmlBytes));

            const articles = new Array();
            dayParser("h3.post-title.entry-title a").each((_, element) => {
                const href = dayParser(element).attr("href");
                const name = dayParser(element).text();
                console.log(href);
                if (href) articles.push({ href, name });
            })

            for (const { href, name } of articles) {
                try {
                    const articleResponse = await fetch(href);
                    if (!articleResponse.ok) {
                        console.warn(`Failed to retrieve article: Status code ${articleResponse.status}`);
                        continue;
                    }

                    const articleBytes = await articleResponse.bytes();
                    const articleArchiveDirectory = path.join(archivePath, `${name.replaceAll("/", "-")}`);
                    fs.mkdirSync(articleArchiveDirectory);

                    const assetsDirectory = path.join(articleArchiveDirectory, "assets");
                    fs.mkdirSync(assetsDirectory);

                    // fs.writeFileSync(htmlPath, articleBytes);

                    const staticsMapPath = path.join(articleArchiveDirectory, "statics_map.json");
                    const $ = cheerio.loadBuffer(Buffer.from(articleBytes), { decodeEntities: true });
                    const images = new Array();
                    $("img").each((_, element) => {
                        images.push($(element));
                    })

                    const htmlPath = path.join(articleArchiveDirectory, "index.html");
                    let htmlString = Buffer.from(articleBytes).toString("utf-8");
                    const staticsMap = {};
                    for (const image of images) {
                        const source = image.attr("src");
                        const staticResponse = await fetch(source);
                        if (!staticResponse.ok) {
                            console.warn(`Failed to retrieve asset ${source}: Status code ${staticResponse.status}`);
                            continue;
                        }

                        const staticContents = await staticResponse.bytes();
                        const hash = crypto.createHash("md5").update(staticContents).digest("hex");
                        const destPath = `${hash}${path.extname(source).length > 0 ? path.extname(source) : ".bin"}`;

                        fs.writeFileSync(path.join(assetsDirectory, destPath), staticContents);
                        htmlString = htmlString.replaceAll(source, path.join("./assets", destPath));
                        staticsMap[destPath] = source;
                    }

                    fs.writeFileSync(staticsMapPath, JSON.stringify(staticsMap));

                    fs.writeFileSync(htmlPath, htmlString);
                } catch (error) {
                    console.warn(`Failed to archive ${name}: ${error}`);
                }
            }
            console.log(`Retrieved ${sourceUrl}`);
        }
    })();
}