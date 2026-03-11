const fs = require('fs');

const svgHeader = '<?xml version="1.0" encoding="UTF-8"?><svg width="100%" height="100%" viewBox="0 0 128 128" xmlns="http://www.w3.org/2000/svg">';
// A simple icon: blue background with a white folder shape
const svgBackground = '<rect width="128" height="128" rx="24" fill="#4285f4"/>';
const svgFolder = '<path d="M16 32c0-8.8 7.2-16 16-16h24l16 16h40c8.8 0 16 7.2 16 16v48c0 8.8-7.2 16-16 16H32c-8.8 0-16-7.2-16-16V32z" fill="#ffffff"/>';
const svgFooter = '</svg>';

const svgContent = svgHeader + svgBackground + svgFolder + svgFooter;

// Create sizes
const sizes = [16, 48, 128];

fs.writeFileSync('icons/icon.svg', svgContent);

// Using a basic conversion if imagemagick isn't guaranteed, 
// wait, Chrome extensions support png. Let's make an HTML file and use puppeteer to screenshot it, or just use python?
// The user is on Mac, they might have sips.
