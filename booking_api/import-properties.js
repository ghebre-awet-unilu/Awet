require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { query } = require("./db");

const propsDir = path.join(
  __dirname,
  "..",
  "luxehome",
  "content",
  "properties",
);

function parseFrontMatter(text) {
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return null;
  const data = {};
  for (const line of match[1].split(/\r?\n/)) {
    const i = line.indexOf(":");
    if (i === -1) continue;
    const key = line.slice(0, i).trim();
    let val = line.slice(i + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (val === "true") val = true;
    else if (val === "false") val = false;
    else if (/^\d+(\.\d+)?$/.test(val)) val = Number(val);
    data[key] = val;
  }
  return data;
}

async function main() {
  const files = fs
    .readdirSync(propsDir)
    .filter((f) => f.endsWith(".md") && f !== "_index.md");

  for (const file of files) {
    const raw = fs.readFileSync(path.join(propsDir, file), "utf8");
    const p = parseFrontMatter(raw);
    if (!p || !p.title) continue;

    const exists = await query(
      "SELECT 1 FROM properties WHERE lower(title) = lower($1)",
      [p.title],
    );
    if (exists.rowCount) {
      console.log("Skipped (already exists):", p.title);
      continue;
    }

    await query(
      `
      INSERT INTO properties (
        title, type, status, location, bedrooms, bathrooms, area,
        price, featured, description, image_path, video_url
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
    `,
      [
        p.title,
        p.type || "",
        p.status || "",
        p.location || "",
        p.bedrooms || 0,
        p.bathrooms || 0,
        p.area || 0,
        p.price || "",
        p.featured ? 1 : 0,
        p.description || "",
        p.image || "",
        p.video_url || "",
      ],
    );

    console.log("Imported:", p.title);
  }

  console.log("Done");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
