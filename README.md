# PonyAggregate Scraper Suite
<p>
This repository contains specialized scraping scripts for automating pony fandom archival efforts, and were specifically made for <a href="https://ponyaggregate.com">PonyAggregate</a> (though they can be used for any platform).

Anypony can contribute meaningfully by creating a <a href="https://github.com/compscitwilight/ponyaggregate-scraping-suite/pulls">pull request</a>.

Below is detailed documentation about what each script is used for, and how you can appropriately use them all.
</p>

## Prerequisites
* Clone with `git clone https://github.com/compscitwilight/ponyaggregate-scraping-suite`
* Install <a href="https://nodejs.org/en/download/current">Node.js</a>
* Run `npm install` before executing any of the scripts in this repository
* Install `yt-dlp` if it's not already on your system.
* Copy `.env.example` to `.env` and configure the required environment variables
    * The upload operation for every script requires a valid PonyAggregate account API key (configured as `PA_API_KEY`). Go to <a href="https://ponyaggregate.com/account/api-access">the API access page</a> on PonyAggregate to obtain your API key.
    * `videoScraper.js` requires a valid Google API key (configured as `GOOGLE_API_KEY`). Go to the <a href="https://console.cloud.google.com/apis/dashboard">Google Cloud Console</a>, enable the **YouTube Data API v3** API, and create an API key for your account before using it.

## `videoScraper.js`
### Overview
This script is responsible for scraping video metadata for a specified YouTube channel and storing as a <a href="https://ponyaggregate.com/developers#post-api-submissions-new">PonyAggregate submission</a> object, downloading videos, and uploading them to PonyAggregate as submissions.

### Usage
#### Scrape video metadata for a channel
```bash
node videoScraper.js [channel_name] [output_location]
```
* `channel_name`: The channel handle for the YouTube channel being scraped (can be found in the URL)
* `output_location`: where to store the scraped metadata and Base64-encoded thumbnails (JSON format)
#### Download videos from metadata
```bash
node videoScraper.js download [metadata_file]  [output_location]
```
* `metadata_file`: the JSON file containing metadata for each video scraped
* `output_location`: where to store the downloaded videos (directory)
#### Upload videos to PonyAggregate with metadata
```bash
node videoScraper.js upload [output_file] [videos_location] [exclusion_list]
```
* `output_file`: the JSON file containing structured metadata and Base64-encoded video thumbnails to upload to PonyAggregate
* `videos_location`: the directory path containing the matching videos
* `exclusion_list`: a comma-separated string of YouTube video IDs that will be ignored if the script comes across an entry in `output_file` with a `canonicalId` inside the list

## `booruScraper.js`
### Overview
Scrapes images from one of the supported My Little Pony imageboorus and uploads them to PonyAggregate with the appropriate metadata.

#### Supported boorus (tested)
* <a href="https://ponerpics.org">Ponerpics</a>
* <a href="https://twibooru.org">Twibooru</a>
* <a href="https://derpibooru.org">Derpibooru</a>
* <a href="https://manebooru.art">Manebooru</a>

### Usage
#### Scrape images from a booru
```bash
node booruScraper.js index [ponerpics | twibooru | derpibooru | manebooru] [query_string] [max_images] [output_location]
```
* `tags`: comma-separated string containing the tags to be included in theimages scraped
* `query_string`: the query string containing tags to search for (found as `?q=` in the search URL on every ponybooru)
* `max_images`: the maximum number of images to scrape
* `output_location`: where to store the metadata and Base64 encoded images (default: `./booru-output.json`)
#### Upload scraped images to PonyAggregate
```bash
node booruScraper.js upload [output_file] [images_directory]
```
* `output_file`: the JSON file containing the structured metadata for each scraped image
* `images_directory`: the directory path containing scraped images
* Note: this script will automatically verify duplicates with the PonyAggregate API (`GET https://static.ponyaggregate.com/api/attachments/check/[md5]`)

## `eqdScraper.js`
### Overview
Scrapes articles on <a href="https://equestriadaily.org">EquestriaDaily</a>, stores metadata in structured batches based on the time range specified.

### Usage
#### Scrape a time range from EquestriaDaily
```bash
node eqdScraper.js index [start] [end][pages_output_location]
```
* `start`: start month for scraping (format: `MM-YYYY`)
* `end`: end month for scraping (format: `MM-YYYY`, must be at least one month after `start`)
* `pages_output_location`: directory path for the archive files which will be created for each page scraped in the format specified.

## `ibScraper.js`
### Overview
Scrapes supported imageboards for thread data and images and archives the threads and metadata in `.zip` format.

#### Supported imageboards (tested)
* <a href="https://4chan.org">4chan (/mlp/)</a>
* <a href="https://nhnb.org">NHNB (No Hooves No Business)</a>

#### Future imageboards
* <a href="https://mlpol.net">mlpol</a>
* <a href="https://ponychan.co">Ponychan</a>

### Usage
#### Scrape an entire board of a supported imageboard
```bash
node ibScraper.js scrape [imageboard] [board] [output_location]
```
* `imageboard`: the supported imageboard from the list above
* `board`: a sub-board (e.g. /mlp/, /fim/, /clop/, /pony/,, etc)
* `output_location`: path for the output directory which will metadata for all threads scraped and their associated images (threads go to `[output_location]/boards/[board]/thread-[thread_id].json`, images go to `[output_location]/images`)

#### Zip a specific thread with their associated images
```bash
node ibScraper.js archive [output_directory] [slug] [output_zip]
```
* `output_directory`: directory path to the directory containing static images and pages
* `slug`: `imageboard/board/thread` format 
* `output_zip`: file path for the resulting `.zip` file containing an archive of entire threads and referenced images