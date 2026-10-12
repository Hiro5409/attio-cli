const { main } = await import("./cli.ts");

process.exitCode = await main();
