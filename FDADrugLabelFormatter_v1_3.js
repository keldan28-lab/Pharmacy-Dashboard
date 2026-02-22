/**
 * FDA Drug Label Formatter Module
 * 
 * @version 1.3.0
 * 
 * CHANGES IN v1.3:
 * - Enhanced subsection detection with capitalized word sequences
 * - Bold section numbers and underlined subsection titles
 * - Better paragraph detection (bullet points, section numbers)
 * - Alphabetically sorted navigation
 * - Hidden subsections in navigation sidebar
 * - Flexible section number format handling (8.1, 8. 1, 8 . 1)
 */

class FDADrugLabelFormatter {
    constructor(options = {}) {
        this.excludedFields = options.excludedFields || [
            'set_id', 
            'id', 
            'effective_time', 
            'version', 
            'openfda'
        ];
        
        this.sectionMapping = options.sectionMapping || {
            'spl_product_data_elements': 'PRODUCT DATA',
            'recent_major_changes': 'RECENT MAJOR CHANGES',
            'boxed_warning': 'BOXED WARNING',
            'indications_and_usage': '1 INDICATIONS AND USAGE',
            'dosage_and_administration': '2 DOSAGE AND ADMINISTRATION',
            'dosage_forms_and_strengths': '3 DOSAGE FORMS AND STRENGTHS',
            'contraindications': '4 CONTRAINDICATIONS',
            'warnings_and_cautions': '5 WARNINGS AND PRECAUTIONS',
            'warnings': '5 WARNINGS AND PRECAUTIONS',
            'precautions': '5 WARNINGS AND PRECAUTIONS',
            'adverse_reactions': '6 ADVERSE REACTIONS',
            'drug_interactions': '7 DRUG INTERACTIONS',
            'use_in_specific_populations': '8 USE IN SPECIFIC POPULATIONS',
            'pregnancy': '8.1 Pregnancy',
            'lactation': '8.2 Lactation',
            'labor_and_delivery': '8.2 Labor and Delivery',
            'nursing_mothers': '8.3 Nursing Mothers',
            'pediatric_use': '8.4 Pediatric Use',
            'geriatric_use': '8.5 Geriatric Use',
            'renal_impairment': '8.6 Renal Impairment',
            'hepatic_impairment': '8.7 Hepatic Impairment',
            'drug_abuse_and_dependence': '9 DRUG ABUSE AND DEPENDENCE',
            'controlled_substance': '9.1 Controlled Substance',
            'abuse': '9.2 Abuse',
            'dependence': '9.3 Dependence',
            'overdosage': '10 OVERDOSAGE',
            'description': '11 DESCRIPTION',
            'clinical_pharmacology': '12 CLINICAL PHARMACOLOGY',
            'mechanism_of_action': '12.1 Mechanism of Action',
            'pharmacodynamics': '12.2 Pharmacodynamics',
            'pharmacokinetics': '12.3 Pharmacokinetics',
            'microbiology': '12.4 Microbiology',
            'nonclinical_toxicology': '13 NONCLINICAL TOXICOLOGY',
            'carcinogenesis_and_mutagenesis_and_impairment_of_fertility': '13.1 Carcinogenesis, Mutagenesis, Impairment of Fertility',
            'animal_pharmacology_and_or_toxicology': '13.2 Animal Pharmacology and/or Toxicology',
            'clinical_studies': '14 CLINICAL STUDIES',
            'references': '15 REFERENCES',
            'how_supplied': '16 HOW SUPPLIED/STORAGE AND HANDLING',
            'storage_and_handling': '16 HOW SUPPLIED/STORAGE AND HANDLING',
            'information_for_patients': '17 PATIENT COUNSELING INFORMATION',
            'patient_counseling_information': '17 PATIENT COUNSELING INFORMATION',
            'spl_medguide': 'MEDICATION GUIDE',
            'package_label_principal_display_panel': 'PACKAGE LABEL',
            'risks': 'RISK SUMMARY'
        };

        this.tableFields = options.tableFields || [
            'recent_major_changes_table',
            'dosage_and_administration_table',
            'adverse_reactions_table',
            'clinical_pharmacology_table',
            'pharmacokinetics_table',
            'clinical_studies_table',
            'spl_medguide_table'
        ];

        this.options = {
            formatScientificNames: true,
            useHighlightBoxes: true,
            useWarningBoxes: true,
            showSectionNumbers: false,
            showSubsectionsInNav: false,  // NEW in v1.3
            sortNavAlphabetically: true,   // NEW in v1.3
            ...options
        };
    }

    /**
     * Parse section number from content (handles various formats)
     * Matches: "8.1", "8. 1", "8 . 1", etc.
     */
    parseSectionNumber(text) {
        const match = text.match(/^(\d+\.?\s*\d*)\s+/);
        if (match) {
            // Normalize: remove spaces
            return match[1].replace(/\s+/g, '');
        }
        return null;
    }

    /**
     * Extract clean title without section number
     */
    extractTitleWithoutNumber(fullTitle) {
        return fullTitle.replace(/^\d+\.?\d*\s+/, '').trim();
    }

    /**
     * Remove title repetition from content
     */
    removeTitleFromContent(content, title) {
        if (!content || !title) return content;
        
        let cleanedContent = content;
        
        const patternWithNumber = new RegExp(`^\\d+\\.?\\s*\\d*\\s+${this.escapeRegex(title)}\\s*`, 'i');
        cleanedContent = cleanedContent.replace(patternWithNumber, '');
        
        const patternWithoutNumber = new RegExp(`^${this.escapeRegex(title)}\\s*`, 'i');
        cleanedContent = cleanedContent.replace(patternWithoutNumber, '');
        
        return cleanedContent.trim();
    }

    /**
     * NEW in v1.3: Enhanced subsection parsing with capitalized word sequences
     * Detects patterns like "8.1 Pregnancy Risk Summary There are..."
     * Returns title as all capitalized words except the last one
     */
    parseSubsectionsEnhanced(content) {
        const subsections = [];
        const lines = content.split(/\n+/);
        
        for (let line of lines) {
            // Match: section number (flexible spacing) + consecutive capitalized words
            // Pattern: "8.1 Pregnancy Risk Summary There" or "8. 1 Pregnancy Risk Summary There"
            const match = line.match(/^(\d+\.?\s*\d+)\s+([A-Z][a-z]*(?:\s+[A-Z][a-z]*)+)/);
            
            if (match) {
                const sectionNum = match[1].replace(/\s+/g, ''); // Normalize "8. 1" to "8.1"
                const capitalizedWords = match[2];
                
                // Split capitalized words
                const words = capitalizedWords.split(/\s+/);
                
                // Title = all words except the last
                // Last word goes to content
                if (words.length >= 2) {
                    const title = words.slice(0, -1).join(' ');
                    
                    // Only add if title is reasonable length
                    if (title.length >= 5 && title.length < 100) {
                        subsections.push({
                            number: sectionNum,
                            title: title,
                            id: `section-${sectionNum.replace('.', '-')}`,
                            fullMatch: match[0]
                        });
                    }
                } else if (words.length === 1 && words[0].length > 5) {
                    // Single capitalized word can be a title if long enough
                    subsections.push({
                        number: sectionNum,
                        title: words[0],
                        id: `section-${sectionNum.replace('.', '-')}`,
                        fullMatch: match[0]
                    });
                }
            }
        }
        
        return subsections;
    }

    /**
     * Split content into main section and subsections
     */
    splitContentBySubsections(content) {
        const subsections = this.parseSubsectionsEnhanced(content);
        
        if (subsections.length === 0) {
            return { main: content, subsections: [] };
        }

        const result = { main: '', subsections: [] };

        // Find position of first subsection
        const firstSubPos = content.indexOf(subsections[0].fullMatch);
        if (firstSubPos > 0) {
            result.main = content.substring(0, firstSubPos).trim();
        }

        // Extract each subsection content
        for (let i = 0; i < subsections.length; i++) {
            const subsection = subsections[i];
            const startPos = content.indexOf(subsection.fullMatch);
            
            if (startPos !== -1) {
                let endPos;
                if (i < subsections.length - 1) {
                    endPos = content.indexOf(subsections[i + 1].fullMatch);
                } else {
                    endPos = content.length;
                }

                let subsectionContent = content.substring(startPos, endPos).trim();
                
                // Remove the matched pattern from content
                // The content starts AFTER the full match
                const matchEnd = startPos + subsection.fullMatch.length;
                subsectionContent = content.substring(matchEnd, endPos).trim();
                
                result.subsections.push({
                    ...subsection,
                    content: subsectionContent
                });
            }
        }

        return result;
    }

    /**
     * Escape special regex characters
     */
    escapeRegex(string) {
        return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    /**
     * NEW in v1.3: Enhanced paragraph formatting with bullet point detection
     * UPDATED: Renders embedded HTML before applying string modifications
     */
    formatParagraphs(text) {
        if (!text) return '';
        
        // First, check if text contains HTML tables or other HTML elements
        // If it does, we need to preserve them
        if (text.includes('<table') || text.includes('<tr') || text.includes('<td')) {
            // Parse and preserve tables, but process the rest
            return this.parseComplexContent(text);
        }
        
        // Split by double newlines OR bullet points
        let paragraphs = text.split(/\n{2,}|(?=\s*•)/);
        
        return paragraphs
            .map(p => p.trim())
            .filter(p => p.length > 0)
            .map(p => {
                // Check if paragraph starts with bullet
                const isBullet = p.trim().startsWith('•');
                
                if (!p.match(/[.!?]$/) && !isBullet) {
                    p += '.';
                }
                
                return `<p class="content-block">${this.formatInlineElements(p)}</p>`;
            })
            .join('\n');
    }

    /**
     * Parse complex content that contains embedded HTML (tables, etc.)
     */
    parseComplexContent(text) {
        // Create a temporary div to properly parse the HTML
        if (typeof document !== 'undefined') {
            const tempDiv = document.createElement('div');
            tempDiv.innerHTML = text;
            
            // Process the content while preserving HTML structure
            // Tables should be rendered as-is
            let processed = tempDiv.innerHTML;
            
            // Clean up any FDA-specific styling
            processed = processed.replace(/styleCode="[^"]*"/gi, '');
            processed = processed.replace(/<content[^>]*>/gi, '');
            processed = processed.replace(/<\/content>/gi, '');
            
            return processed;
        }
        
        // Fallback if document is not available (Node.js environment)
        return text;
    }

    /**
     * Format inline elements (italics, bold, etc.)
     */
    formatInlineElements(text) {
        if (!this.options.formatScientificNames) {
            return text;
        }

        const scientificNamePattern = /\b([A-Z][a-z]+\s+[a-z]+)\b/g;
        text = text.replace(scientificNamePattern, (match) => {
            if (match.match(/^[A-Z][a-z]+\s+[a-z]+$/)) {
                return `<em>${match}</em>`;
            }
            return match;
        });

        return text;
    }

    /**
     * Parse and clean HTML tables
     */
    parseTable(tableHtml) {
        if (!tableHtml) return '';
        
        let cleanHtml = tableHtml
            .replace(/styleCode="[^"]*"/g, '')
            .replace(/<content[^>]*>/g, '')
            .replace(/<\/content>/g, '')
            .replace(/<linkHtml[^>]*>/g, '')
            .replace(/<\/linkHtml>/g, '');
        
        return cleanHtml;
    }

    /**
     * Determine if section should have highlight box
     */
    shouldHighlight(sectionKey, content) {
        if (!this.options.useHighlightBoxes) return false;
        const highlightSections = ['indications_and_usage', 'adverse_reactions'];
        return highlightSections.includes(sectionKey);
    }

    /**
     * Determine if section should have warning box
     */
    shouldWarn(sectionKey, content) {
        if (!this.options.useWarningBoxes) return false;
        const warnSections = ['contraindications', 'warnings', 'warnings_and_cautions', 'boxed_warning'];
        return warnSections.includes(sectionKey);
    }

    /**
     * Extract drug name from API data
     */
    extractDrugName(data) {
        if (data.spl_product_data_elements && data.spl_product_data_elements[0]) {
            return data.spl_product_data_elements[0].split(' ')[0];
        }
        
        if (data.openfda && data.openfda.brand_name && data.openfda.brand_name[0]) {
            return data.openfda.brand_name[0];
        }
        
        if (data.openfda && data.openfda.generic_name && data.openfda.generic_name[0]) {
            return data.openfda.generic_name[0];
        }
        
        return 'Drug Label Information';
    }

    /**
     * NEW in v1.3: Build navigation HTML (alphabetically sorted, no subsections)
     */
    buildNavigation(sections) {
        let navHtml = '<h2>Drug Label Sections</h2><ul id="nav-menu">';
        
        // Sort sections alphabetically by title (without numbers)
        let sortedSections = [...sections];
        if (this.options.sortNavAlphabetically) {
            sortedSections.sort((a, b) => {
                const titleA = this.extractTitleWithoutNumber(a.title).toLowerCase();
                const titleB = this.extractTitleWithoutNumber(b.title).toLowerCase();
                return titleA.localeCompare(titleB);
            });
        }
        
        for (let section of sortedSections) {
            const displayTitle = this.options.showSectionNumbers ? 
                section.title : 
                this.extractTitleWithoutNumber(section.title);
            
            navHtml += `<li><a href="#${section.id}" data-section="${section.id}">${displayTitle}</a></li>`;
        }
        
        navHtml += '</ul>';
        return navHtml;
    }

    /**
     * NEW in v1.3: Build main content HTML with enhanced subsection formatting
     */
    buildContent(drugName, sections) {
        let contentHtml = `
            <div class="drug-header">
                <h1>${drugName}</h1>
                <p>FDA Drug Label Information</p>
            </div>
        `;

        for (let section of sections) {
            contentHtml += `<section class="section" id="${section.id}">`;
            
            const displayTitle = this.options.showSectionNumbers ? 
                section.title : 
                this.extractTitleWithoutNumber(section.title);
            contentHtml += `<h2 class="section-title">${displayTitle}</h2>`;

            // Main section content
            if (section.mainContent) {
                const cleanedContent = this.removeTitleFromContent(section.mainContent, displayTitle);
                
                const boxClass = this.shouldWarn(section.key, cleanedContent) ? 'warning-box' : 
                               this.shouldHighlight(section.key, cleanedContent) ? 'highlight-box' : '';
                
                if (boxClass) {
                    contentHtml += `<div class="${boxClass}">`;
                }
                
                contentHtml += this.formatParagraphs(cleanedContent);
                
                if (boxClass) {
                    contentHtml += `</div>`;
                }
            }

            // Tables
            if (section.tables && section.tables.length > 0) {
                for (let table of section.tables) {
                    contentHtml += this.parseTable(table);
                }
            }

            // Subsections with enhanced formatting
            if (section.subsections && section.subsections.length > 0) {
                for (let subsection of section.subsections) {
                    contentHtml += `<div class="subsection" id="${subsection.id}">`;
                    // NEW: Bold number, underlined title
                    contentHtml += `<h3 class="subsection-title"><strong>${subsection.number}</strong> <u>${subsection.title}</u></h3>`;
                    contentHtml += this.formatParagraphs(subsection.content);
                    contentHtml += `</div>`;
                }
            }

            contentHtml += `</section>`;
        }

        return contentHtml;
    }

    /**
     * Main formatting function
     */
    format(apiData) {
        if (!apiData.results || apiData.results.length === 0) {
            throw new Error('No drug label data found in API response');
        }

        const data = apiData.results[0];
        const drugName = this.extractDrugName(data);
        const sections = [];

        for (let [key, value] of Object.entries(data)) {
            if (this.excludedFields.includes(key)) {
                continue;
            }
            
            if (this.sectionMapping[key] && Array.isArray(value) && value.length > 0) {
                const content = value[0];
                const sectionNumber = this.parseSectionNumber(content);
                const sectionId = sectionNumber ? `section-${sectionNumber.replace('.', '-')}` : `section-${key}`;
                
                const parsed = this.splitContentBySubsections(content);
                
                sections.push({
                    id: sectionId,
                    key: key,
                    title: this.sectionMapping[key],
                    number: sectionNumber,
                    mainContent: parsed.main,
                    subsections: parsed.subsections,
                    tables: []
                });
            }
        }

        // Add tables to their corresponding sections
        for (let tableField of this.tableFields) {
            if (data[tableField] && Array.isArray(data[tableField])) {
                const baseField = tableField.replace('_table', '');
                const section = sections.find(s => s.key === baseField);
                if (section) {
                    section.tables = data[tableField];
                }
            }
        }

        // Sort sections by number (for content display)
        sections.sort((a, b) => {
            const numA = parseFloat(a.number || '999');
            const numB = parseFloat(b.number || '999');
            return numA - numB;
        });

        const navHtml = this.buildNavigation(sections);
        const contentHtml = this.buildContent(drugName, sections);

        return {
            navigation: navHtml,
            content: contentHtml,
            drugName: drugName,
            sections: sections
        };
    }

    /**
     * Fetch and format drug label from FDA API
     */
    async fetchAndFormat(ndc) {
        const apiUrl = `https://api.fda.gov/drug/label.json?search=openfda.product_ndc:"${ndc}"`;
        
        try {
            const response = await fetch(apiUrl);
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            
            const data = await response.json();
            return this.format(data);
        } catch (error) {
            throw new Error(`Failed to fetch drug label: ${error.message}`);
        }
    }
}

// Export for use in Node.js or as ES6 module
if (typeof module !== 'undefined' && module.exports) {
    module.exports = FDADrugLabelFormatter;
}

// Export for use in browser as global
if (typeof window !== 'undefined') {
    window.FDADrugLabelFormatter = FDADrugLabelFormatter;
}
