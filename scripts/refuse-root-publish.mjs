// The repository root is the workspace, not the package. ng-packagr writes the package to dist/
// (without this script), so a publish from the root stops here.
console.error('Publish the built package instead: npm run build && npm publish ./dist');
process.exit(1);
