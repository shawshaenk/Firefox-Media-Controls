const esbuild = require("esbuild");
const fs = require("fs");
const path = require("path");

const isWatch = process.argv.includes("--watch");

async function copyStaticFiles() {
  fs.copyFileSync(
    path.join(__dirname, "src/popup/popup.html"),
    path.join(__dirname, "popup.html")
  );
  fs.copyFileSync(
    path.join(__dirname, "src/popup/popup.css"),
    path.join(__dirname, "popup.css")
  );
  console.log("Copied popup.html and popup.css to root");
}

async function build() {
  copyStaticFiles();

  const entries = [
    {
      entryPoints: ["src/page-hook.ts"],
      outfile: "page-hook.js",
      format: "iife"
    },
    {
      entryPoints: ["src/relay.ts"],
      outfile: "relay.js",
      format: "iife"
    },
    {
      entryPoints: ["src/background.ts"],
      outfile: "background.js",
      format: "iife"
    },
    {
      entryPoints: ["src/popup/popup.ts"],
      outfile: "popup.js",
      format: "iife"
    }
  ];

  for (const entry of entries) {
    const buildOptions = {
      entryPoints: entry.entryPoints,
      outfile: entry.outfile,
      bundle: true,
      format: entry.format,
      target: ["firefox128", "es2022"],
      sourcemap: true,
      logLevel: "info"
    };

    if (isWatch) {
      const ctx = await esbuild.context(buildOptions);
      await ctx.watch();
    } else {
      await esbuild.build(buildOptions);
    }
  }

  console.log("Build completed successfully.");
}

build().catch((err) => {
  console.error("Build failed:", err);
  process.exit(1);
});
