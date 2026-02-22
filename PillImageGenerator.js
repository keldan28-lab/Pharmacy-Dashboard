/**
 * Pill Image Generator v2.1
 * Generates SVG representations of pharmaceutical pills based on FDA properties
 * Uses FDA shape codes (C48xxx) and color codes (C48xxx)
 * 
 * CHANGES IN v2.1:
 * - Added embossed score lines that cut across tablets at shortest distance
 * - Removed imprint text from pill render
 * - Added shape name display next to color text
 * - Score lines use embossed styling matching pill aesthetics
 */

class PillImageGenerator {
    // FDA Color Code Mapping (C48xxx format)
    static colorMap = {
        'C48323': 'rgb(0, 0, 0)',           // BLACK
        'C48324': 'rgb(128, 128, 128)',     // GRAY
        'C48325': 'rgb(255, 255, 255)',     // WHITE
        'C48326': 'rgb(255, 0, 0)',         // RED
        'C48327': 'rgb(128, 0, 128)',       // PURPLE
        'C48328': 'rgb(255, 192, 203)',     // PINK
        'C48329': 'rgb(0, 128, 0)',         // GREEN
        'C48330': 'rgb(255, 255, 0)',       // YELLOW
        'C48331': 'rgb(255, 165, 0)',       // ORANGE
        'C48332': 'rgb(165, 42, 42)',       // BROWN
        'C48333': 'rgb(0, 0, 255)',         // BLUE
        'C48334': 'rgb(64, 224, 208)',      // TURQUOISE
    };
    
    // FDA Shape Code Mapping
    static shapeMap = {
        'C48335': 'BULLET',
        'C48336': 'CAPSULE',
        'C48337': 'CLOVER',
        'C48338': 'DIAMOND',
        'C48339': 'DOUBLE CIRCLE',
        'C48340': 'FREEFORM',
        'C48341': 'GEAR',
        'C48342': 'HEPTAGON',
        'C48343': 'HEXAGON',
        'C48344': 'OCTAGON',
        'C48345': 'OVAL',
        'C48346': 'PENTAGON',
        'C48347': 'RECTANGLE',
        'C48348': 'ROUND',
        'C48349': 'SEMI-CIRCLE',
        'C48350': 'SQUARE',
        'C48351': 'TEAR',
        'C48352': 'TRAPEZOID',
        'C48353': 'TRIANGLE',
    };
    
    /**
     * Generate embossed score line (NEW in v2.1)
     */
    static generateScoreLine(x1, y1, x2, y2) {
        return `
            <!-- Score line with embossed effect -->
            <line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" 
                  stroke="rgba(0,0,0,0.5)" 
                  stroke-width="3"/>
            <line x1="${x1}" y1="${y1 + 1}" x2="${x2}" y2="${y2 + 1}" 
                  stroke="rgba(255,255,255,0.8)" 
                  stroke-width="1.5"/>
        `;
    }
    
    /**
     * Generate SVG for a pill based on properties
     */
    static generatePillSVG(propertyMap) {
        // DEBUG: Log the property map
        console.log('🔍 PillImageGenerator received propertyMap:', propertyMap);
        
        if (!propertyMap) {
            return this.generatePlaceholder();
        }
        
        // Handle COLOR property
        const colorProp = propertyMap.COLOR || '';
        const colors = colorProp.split(';').map(c => c.trim()).filter(c => c);
        
        // Map FDA color codes to RGB
        const mappedColors = colors.map(c => this.colorMap[c] || c).filter(c => c);
        const isTwoTone = mappedColors.length > 1;
        
        const color = mappedColors[0] || '#CCCCCC';
        const color2 = mappedColors[1] || null;
        
        const colorText = propertyMap.COLORTEXT || 'Unknown';
        const shape = propertyMap.SHAPE;
        const shapeText = this.shapeMap[shape] || 'Unknown';
        const size = parseFloat(propertyMap.SPLSIZE || propertyMap.SIZE) || 10;
        
        // Score interpretation: 1 = no lines, 2 = 1 line, 3 = 2 lines
        // Check both SPLSCORE and SCORE property names
        const scoreValue = parseInt(propertyMap.SPLSCORE || propertyMap.SCORE) || 1;
        const scoreLines = Math.max(0, scoreValue - 1);
        
        // DEBUG: Log score information
        console.log(`🎯 Score Debug - Raw SPLSCORE: "${propertyMap.SPLSCORE}", Raw SCORE: "${propertyMap.SCORE}", Parsed: ${scoreValue}, Lines to draw: ${scoreLines}`);
        
        const viewBoxSize = 120;
        const scaleFactor = viewBoxSize / Math.max(size, 8);
        
        let svgContent = '';
        
        // Generate shape based on FDA code
        switch (shape) {
            case 'C48348': // ROUND
                svgContent = this.generateRound(color, color2, scoreLines, scaleFactor);
                break;
            case 'C48336': // CAPSULE
                svgContent = this.generateCapsule(color, color2, scaleFactor);
                break;
            case 'C48345': // OVAL
                svgContent = this.generateOval(color, color2, scoreLines, scaleFactor);
                break;
            case 'C48347': // RECTANGLE
                svgContent = this.generateRectangle(color, color2, scoreLines, scaleFactor);
                break;
            case 'C48350': // SQUARE
                svgContent = this.generateSquare(color, color2, scoreLines, scaleFactor);
                break;
            case 'C48353': // TRIANGLE
                svgContent = this.generateTriangle(color, scaleFactor);
                break;
            case 'C48338': // DIAMOND
                svgContent = this.generateDiamond(color, scaleFactor);
                break;
            case 'C48346': // PENTAGON
                svgContent = this.generatePentagon(color, scaleFactor);
                break;
            case 'C48343': // HEXAGON
                svgContent = this.generateHexagon(color, color2, scoreLines, scaleFactor);
                break;
            case 'C48344': // OCTAGON
                svgContent = this.generateOctagon(color, color2, scoreLines, scaleFactor);
                break;
            case 'C48342': // HEPTAGON
                svgContent = this.generateHeptagon(color, scaleFactor);
                break;
            case 'C48335': // BULLET
                svgContent = this.generateBullet(color, scaleFactor);
                break;
            case 'C48337': // CLOVER
                svgContent = this.generateClover(color, scaleFactor);
                break;
            case 'C48339': // DOUBLE CIRCLE
                svgContent = this.generateDoubleCircle(color, scaleFactor);
                break;
            case 'C48349': // SEMI-CIRCLE
                svgContent = this.generateSemiCircle(color, scaleFactor);
                break;
            case 'C48351': // TEAR
                svgContent = this.generateTear(color, scaleFactor);
                break;
            case 'C48352': // TRAPEZOID
                svgContent = this.generateTrapezoid(color, color2, scoreLines, scaleFactor);
                break;
            case 'C48341': // GEAR
                svgContent = this.generateGear(color, scaleFactor);
                break;
            case 'C48340': // FREEFORM
                svgContent = this.generateFreeform(color, scaleFactor);
                break;
            default:
                svgContent = this.generateRound(color, color2, scoreLines, scaleFactor);
        }
        
        return `
            <div class="pill-display-container">
                <svg viewBox="0 0 ${viewBoxSize} ${viewBoxSize}" xmlns="http://www.w3.org/2000/svg" class="pill-svg">
                    ${svgContent}
                </svg>
                <div class="pill-info">
                    <div class="pill-color-text">${colorText}, ${shapeText}</div>
                    ${propertyMap.IMPRINT_CODE ? `<div class="pill-imprint-text">Imprint: ${propertyMap.IMPRINT_CODE}</div>` : ''}
                    ${scoreLines > 0 ? `<div class="pill-score-text">Score: ${scoreLines} line${scoreLines > 1 ? 's' : ''}</div>` : ''}
                </div>
            </div>
        `;
    }
    
    /**
     * Generate round pill with score lines
     */
    static generateRound(color, color2, scoreLines, scale) {
        const cx = 60;
        const cy = 60;
        const r = 45;
        
        let content = '';
        
        if (color2) {
            // Two-tone: split horizontally
            content += `
                <defs>
                    <clipPath id="topHalf">
                        <rect x="15" y="15" width="90" height="45"/>
                    </clipPath>
                    <clipPath id="bottomHalf">
                        <rect x="15" y="60" width="90" height="45"/>
                    </clipPath>
                </defs>
                <circle cx="${cx}" cy="${cy}" r="${r}" fill="${color}" clip-path="url(#topHalf)" stroke="#333" stroke-width="2"/>
                <circle cx="${cx}" cy="${cy}" r="${r}" fill="${color2}" clip-path="url(#bottomHalf)" stroke="#333" stroke-width="2"/>
                <line x1="${cx - r}" y1="${cy}" x2="${cx + r}" y2="${cy}" stroke="#333" stroke-width="2.5"/>
            `;
        } else {
            content += `
                <circle cx="${cx}" cy="${cy}" r="${r}" fill="${color}" stroke="#333" stroke-width="2"/>
            `;
        }
        
        // Add score lines BEFORE shadow
        if (scoreLines === 1) {
            content += this.generateScoreLine(cx, cy - r, cx, cy + r);
        } else if (scoreLines === 2) {
            content += this.generateScoreLine(cx, cy - r, cx, cy + r);
            content += this.generateScoreLine(cx - r, cy, cx + r, cy);
        }
        
        // Shadow on top
        content += `<ellipse cx="${cx}" cy="${cy + 5}" rx="${r - 5}" ry="${r - 8}" fill="rgba(0,0,0,0.1)"/>`;
        
        return content;
    }
    
    /**
     * Generate capsule pill (no score lines for capsules)
     */
    static generateCapsule(color, color2, scale) {
        let content = '';
        
        if (color2) {
            content += `
                <defs>
                    <clipPath id="leftHalf">
                        <rect x="15" y="35" width="45" height="50"/>
                    </clipPath>
                    <clipPath id="rightHalf">
                        <rect x="60" y="35" width="45" height="50"/>
                    </clipPath>
                </defs>
                <rect x="30" y="40" width="60" height="40" rx="20" ry="20" fill="${color}" clip-path="url(#leftHalf)" stroke="#333" stroke-width="2"/>
                <rect x="30" y="40" width="60" height="40" rx="20" ry="20" fill="${color2}" clip-path="url(#rightHalf)" stroke="#333" stroke-width="2"/>
                <line x1="60" y1="40" x2="60" y2="80" stroke="#333" stroke-width="2"/>
                <ellipse cx="60" cy="75" rx="25" ry="8" fill="rgba(0,0,0,0.1)"/>
            `;
        } else {
            content += `
                <rect x="30" y="40" width="60" height="40" rx="20" ry="20" fill="${color}" stroke="#333" stroke-width="2"/>
                <ellipse cx="60" cy="75" rx="25" ry="8" fill="rgba(0,0,0,0.1)"/>
            `;
        }
        
        return content;
    }
    
    /**
     * Generate oval pill with score lines
     */
    static generateOval(color, color2, scoreLines, scale) {
        const cx = 60;
        const cy = 60;
        const rx = 45;
        const ry = 30;
        
        let content = '';
        
        if (color2) {
            content += `
                <defs>
                    <clipPath id="topHalfOval">
                        <rect x="15" y="30" width="90" height="30"/>
                    </clipPath>
                    <clipPath id="bottomHalfOval">
                        <rect x="15" y="60" width="90" height="30"/>
                    </clipPath>
                </defs>
                <ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="${color}" clip-path="url(#topHalfOval)" stroke="#333" stroke-width="2"/>
                <ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="${color2}" clip-path="url(#bottomHalfOval)" stroke="#333" stroke-width="2"/>
                <line x1="${cx - rx}" y1="${cy}" x2="${cx + rx}" y2="${cy}" stroke="#333" stroke-width="2.5"/>
                <ellipse cx="${cx}" cy="${cy + 5}" rx="${rx - 5}" ry="${ry - 5}" fill="rgba(0,0,0,0.1)"/>
            `;
        } else {
            content += `
                <ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="${color}" stroke="#333" stroke-width="2"/>
                <ellipse cx="${cx}" cy="${cy + 5}" rx="${rx - 5}" ry="${ry - 5}" fill="rgba(0,0,0,0.1)"/>
            `;
        }
        
        // Add score lines - shortest distance is across the minor axis (vertical)
        if (scoreLines === 1) {
            content += this.generateScoreLine(cx, cy - ry, cx, cy + ry);
        } else if (scoreLines === 2) {
            content += this.generateScoreLine(cx, cy - ry, cx, cy + ry);
            content += this.generateScoreLine(cx - rx, cy, cx + rx, cy);
        }
        
        return content;
    }
    
    /**
     * Generate rectangle pill with score lines
     */
    static generateRectangle(color, color2, scoreLines, scale) {
        const x = 25;
        const y = 40;
        const width = 70;
        const height = 40;
        
        let content = '';
        
        if (color2) {
            content += `
                <defs>
                    <clipPath id="topHalfRect">
                        <rect x="${x}" y="${y}" width="${width}" height="${height / 2}"/>
                    </clipPath>
                    <clipPath id="bottomHalfRect">
                        <rect x="${x}" y="${y + height / 2}" width="${width}" height="${height / 2}"/>
                    </clipPath>
                </defs>
                <rect x="${x}" y="${y}" width="${width}" height="${height}" rx="3" fill="${color}" clip-path="url(#topHalfRect)" stroke="#333" stroke-width="2"/>
                <rect x="${x}" y="${y}" width="${width}" height="${height}" rx="3" fill="${color2}" clip-path="url(#bottomHalfRect)" stroke="#333" stroke-width="2"/>
                <line x1="${x}" y1="${y + height / 2}" x2="${x + width}" y2="${y + height / 2}" stroke="#333" stroke-width="2.5"/>
            `;
        } else {
            content += `
                <rect x="${x}" y="${y}" width="${width}" height="${height}" rx="3" fill="${color}" stroke="#333" stroke-width="2"/>
            `;
        }
        
        content += `<rect x="${x + 3}" y="${y + 3}" width="${width - 6}" height="${height - 6}" rx="3" fill="rgba(0,0,0,0.05)"/>`;
        
        // Add score lines - shortest distance is across the height (vertical)
        if (scoreLines === 1) {
            content += this.generateScoreLine(x + width / 2, y, x + width / 2, y + height);
        } else if (scoreLines === 2) {
            content += this.generateScoreLine(x + width / 2, y, x + width / 2, y + height);
            content += this.generateScoreLine(x, y + height / 2, x + width, y + height / 2);
        }
        
        return content;
    }
    
    /**
     * Generate square pill with score lines
     */
    static generateSquare(color, color2, scoreLines, scale) {
        const size = 60;
        const x = 30;
        const y = 30;
        
        let content = '';
        
        if (color2) {
            content += `
                <defs>
                    <clipPath id="topHalfSquare">
                        <rect x="${x}" y="${y}" width="${size}" height="${size / 2}"/>
                    </clipPath>
                    <clipPath id="bottomHalfSquare">
                        <rect x="${x}" y="${y + size / 2}" width="${size}" height="${size / 2}"/>
                    </clipPath>
                </defs>
                <rect x="${x}" y="${y}" width="${size}" height="${size}" rx="4" fill="${color}" clip-path="url(#topHalfSquare)" stroke="#333" stroke-width="2"/>
                <rect x="${x}" y="${y}" width="${size}" height="${size}" rx="4" fill="${color2}" clip-path="url(#bottomHalfSquare)" stroke="#333" stroke-width="2"/>
                <line x1="${x}" y1="${y + size / 2}" x2="${x + size}" y2="${y + size / 2}" stroke="#333" stroke-width="2.5"/>
            `;
        } else {
            content += `
                <rect x="${x}" y="${y}" width="${size}" height="${size}" rx="4" fill="${color}" stroke="#333" stroke-width="2"/>
            `;
        }
        
        content += `<rect x="${x + 3}" y="${y + 3}" width="${size - 6}" height="${size - 6}" rx="4" fill="rgba(0,0,0,0.05)"/>`;
        
        // Add score lines
        if (scoreLines === 1) {
            content += this.generateScoreLine(x + size / 2, y, x + size / 2, y + size);
        } else if (scoreLines === 2) {
            content += this.generateScoreLine(x + size / 2, y, x + size / 2, y + size);
            content += this.generateScoreLine(x, y + size / 2, x + size, y + size / 2);
        }
        
        return content;
    }
    
    /**
     * Generate triangle pill
     */
    static generateTriangle(color, scale) {
        const points = "60,25 95,85 25,85";
        return `
            <polygon points="${points}" fill="${color}" stroke="#333" stroke-width="2"/>
            <polygon points="60,30 90,80 30,80" fill="rgba(0,0,0,0.05)"/>
        `;
    }
    
    /**
     * Generate diamond pill
     */
    static generateDiamond(color, scale) {
        const points = "60,20 95,60 60,100 25,60";
        return `
            <polygon points="${points}" fill="${color}" stroke="#333" stroke-width="2"/>
            <polygon points="60,25 90,60 60,95 30,60" fill="rgba(0,0,0,0.05)"/>
        `;
    }
    
    /**
     * Generate pentagon pill
     */
    static generatePentagon(color, scale) {
        const points = "60,20 95,45 80,85 40,85 25,45";
        return `
            <polygon points="${points}" fill="${color}" stroke="#333" stroke-width="2"/>
            <polygon points="60,25 90,48 78,80 42,80 30,48" fill="rgba(0,0,0,0.05)"/>
        `;
    }
    
    /**
     * Generate hexagon pill with score lines
     */
    static generateHexagon(color, color2, scoreLines, scale) {
        const points = "60,20 90,35 90,65 60,80 30,65 30,35";
        
        let content = '';
        
        if (color2) {
            content += `
                <defs>
                    <clipPath id="topHalfHex">
                        <rect x="30" y="20" width="60" height="30"/>
                    </clipPath>
                    <clipPath id="bottomHalfHex">
                        <rect x="30" y="50" width="60" height="30"/>
                    </clipPath>
                </defs>
                <polygon points="${points}" fill="${color}" clip-path="url(#topHalfHex)" stroke="#333" stroke-width="2"/>
                <polygon points="${points}" fill="${color2}" clip-path="url(#bottomHalfHex)" stroke="#333" stroke-width="2"/>
                <line x1="30" y1="50" x2="90" y2="50" stroke="#333" stroke-width="2.5"/>
            `;
        } else {
            content += `<polygon points="${points}" fill="${color}" stroke="#333" stroke-width="2"/>`;
        }
        
        content += `<polygon points="60,25 85,38 85,62 60,75 35,62 35,38" fill="rgba(0,0,0,0.05)"/>`;
        
        // Add score lines - shortest distance is vertical
        if (scoreLines === 1) {
            content += this.generateScoreLine(60, 20, 60, 80);
        } else if (scoreLines === 2) {
            content += this.generateScoreLine(60, 20, 60, 80);
            content += this.generateScoreLine(30, 50, 90, 50);
        }
        
        return content;
    }
    
    /**
     * Generate octagon pill with score lines
     */
    static generateOctagon(color, color2, scoreLines, scale) {
        const points = "45,25 75,25 90,40 90,70 75,85 45,85 30,70 30,40";
        
        let content = '';
        
        if (color2) {
            content += `
                <defs>
                    <clipPath id="topHalfOct">
                        <rect x="30" y="25" width="60" height="30"/>
                    </clipPath>
                    <clipPath id="bottomHalfOct">
                        <rect x="30" y="55" width="60" height="30"/>
                    </clipPath>
                </defs>
                <polygon points="${points}" fill="${color}" clip-path="url(#topHalfOct)" stroke="#333" stroke-width="2"/>
                <polygon points="${points}" fill="${color2}" clip-path="url(#bottomHalfOct)" stroke="#333" stroke-width="2"/>
                <line x1="30" y1="55" x2="90" y2="55" stroke="#333" stroke-width="2.5"/>
            `;
        } else {
            content += `<polygon points="${points}" fill="${color}" stroke="#333" stroke-width="2"/>`;
        }
        
        content += `<polygon points="48,28 72,28 85,41 85,69 72,82 48,82 35,69 35,41" fill="rgba(0,0,0,0.05)"/>`;
        
        // Add score lines
        if (scoreLines === 1) {
            content += this.generateScoreLine(60, 25, 60, 85);
        } else if (scoreLines === 2) {
            content += this.generateScoreLine(60, 25, 60, 85);
            content += this.generateScoreLine(30, 55, 90, 55);
        }
        
        return content;
    }
    
    /**
     * Generate heptagon pill
     */
    static generateHeptagon(color, scale) {
        const points = "60,20 85,32 95,55 80,78 40,78 25,55 35,32";
        return `
            <polygon points="${points}" fill="${color}" stroke="#333" stroke-width="2"/>
            <polygon points="60,25 82,35 90,55 78,73 42,73 30,55 38,35" fill="rgba(0,0,0,0.05)"/>
        `;
    }
    
    /**
     * Generate bullet pill
     */
    static generateBullet(color, scale) {
        return `
            <path d="M 40 60 L 40 45 Q 40 30 55 30 L 65 30 Q 80 30 80 45 L 80 60 Q 80 85 60 95 Q 40 85 40 60 Z" 
                  fill="${color}" stroke="#333" stroke-width="2"/>
            <ellipse cx="60" cy="80" rx="15" ry="10" fill="rgba(0,0,0,0.1)"/>
        `;
    }
    
    /**
     * Generate clover pill
     */
    static generateClover(color, scale) {
        return `
            <circle cx="45" cy="45" r="18" fill="${color}" stroke="#333" stroke-width="2"/>
            <circle cx="75" cy="45" r="18" fill="${color}" stroke="#333" stroke-width="2"/>
            <circle cx="45" cy="75" r="18" fill="${color}" stroke="#333" stroke-width="2"/>
            <circle cx="75" cy="75" r="18" fill="${color}" stroke="#333" stroke-width="2"/>
            <ellipse cx="60" cy="80" rx="20" ry="8" fill="rgba(0,0,0,0.1)"/>
        `;
    }
    
    /**
     * Generate double circle pill
     */
    static generateDoubleCircle(color, scale) {
        return `
            <circle cx="45" cy="60" r="30" fill="${color}" stroke="#333" stroke-width="2"/>
            <circle cx="75" cy="60" r="30" fill="${color}" stroke="#333" stroke-width="2"/>
            <ellipse cx="60" cy="75" rx="40" ry="10" fill="rgba(0,0,0,0.1)"/>
        `;
    }
    
    /**
     * Generate semi-circle pill
     */
    static generateSemiCircle(color, scale) {
        return `
            <path d="M 30 30 L 70 30 Q 95 60 70 90 L 30 90 Z" fill="${color}" stroke="#333" stroke-width="2"/>
            <ellipse cx="50" cy="75" rx="25" ry="8" fill="rgba(0,0,0,0.1)"/>
        `;
    }
    
    /**
     * Generate tear pill
     */
    static generateTear(color, scale) {
        return `
            <path d="M 60 25 Q 85 40 85 65 Q 85 90 60 95 Q 35 90 35 65 Q 35 40 60 25 Z" 
                  fill="${color}" stroke="#333" stroke-width="2"/>
            <ellipse cx="60" cy="80" rx="20" ry="8" fill="rgba(0,0,0,0.1)"/>
        `;
    }
    
    /**
     * Generate trapezoid pill with score lines
     */
    static generateTrapezoid(color, color2, scoreLines, scale) {
        const points = "40,30 80,30 90,80 30,80";
        
        let content = '';
        
        if (color2) {
            content += `
                <defs>
                    <clipPath id="topHalfTrap">
                        <rect x="30" y="30" width="60" height="25"/>
                    </clipPath>
                    <clipPath id="bottomHalfTrap">
                        <rect x="30" y="55" width="60" height="25"/>
                    </clipPath>
                </defs>
                <polygon points="${points}" fill="${color}" clip-path="url(#topHalfTrap)" stroke="#333" stroke-width="2"/>
                <polygon points="${points}" fill="${color2}" clip-path="url(#bottomHalfTrap)" stroke="#333" stroke-width="2"/>
                <line x1="35" y1="55" x2="85" y2="55" stroke="#333" stroke-width="2.5"/>
            `;
        } else {
            content += `<polygon points="${points}" fill="${color}" stroke="#333" stroke-width="2"/>`;
        }
        
        content += `<polygon points="42,35 78,35 85,75 35,75" fill="rgba(0,0,0,0.05)"/>`;
        
        // Add score lines - shortest distance is vertical
        if (scoreLines === 1) {
            content += this.generateScoreLine(60, 30, 60, 80);
        } else if (scoreLines === 2) {
            content += this.generateScoreLine(60, 30, 60, 80);
            content += this.generateScoreLine(35, 55, 85, 55);
        }
        
        return content;
    }
    
    /**
     * Generate gear pill
     */
    static generateGear(color, scale) {
        return `
            <polygon points="60,15 65,25 75,20 75,30 85,35 80,45 90,50 80,55 85,65 75,70 75,80 65,75 60,85 55,75 45,80 45,70 35,65 40,55 30,50 40,45 35,35 45,30 45,20 55,25" 
                     fill="${color}" stroke="#333" stroke-width="2"/>
            <circle cx="60" cy="50" r="15" fill="${color}" stroke="#333" stroke-width="2"/>
        `;
    }
    
    /**
     * Generate freeform pill
     */
    static generateFreeform(color, scale) {
        return `
            <path d="M 30 50 Q 30 25 50 25 Q 70 25 80 35 Q 95 45 95 60 Q 95 80 75 90 Q 55 95 40 85 Q 25 75 30 50 Z" 
                  fill="${color}" stroke="#333" stroke-width="2"/>
            <ellipse cx="55" cy="75" rx="25" ry="10" fill="rgba(0,0,0,0.1)"/>
        `;
    }
    
    /**
     * Generate placeholder when no pill data available
     */
    static generatePlaceholder() {
        return `
            <div class="pill-display-container">
                <svg viewBox="0 0 120 120" xmlns="http://www.w3.org/2000/svg" class="pill-svg">
                    <circle cx="60" cy="60" r="45" fill="#E5E7EB" stroke="#9CA3AF" stroke-width="2" stroke-dasharray="5,5"/>
                    <text x="60" y="65" text-anchor="middle" fill="#6B7280" font-size="12" font-family="Arial">
                        No pill data
                    </text>
                </svg>
                <div class="pill-info">
                    <div class="pill-color-text" style="color: #9CA3AF;">N/A</div>
                </div>
            </div>
        `;
    }
    
    /**
     * Check if discontinued based on marketing status
     */
    static isDiscontinued(propertyMap) {
        if (!propertyMap) return false;
        
        const highDate = propertyMap.MARKETING_EFFECTIVE_TIME_HIGH;
        const status = propertyMap.MARKETING_STATUS;
        
        if (highDate && highDate !== 'null' && highDate.trim() !== '') {
            return true;
        }
        
        if (!highDate && status && status !== 'ACTIVE') {
            return true;
        }
        
        return false;
    }
}

// Make available globally
if (typeof window !== 'undefined') {
    window.PillImageGenerator = PillImageGenerator;
}

// Export for use in Node.js or as ES6 module
if (typeof module !== 'undefined' && module.exports) {
    module.exports = PillImageGenerator;
}
