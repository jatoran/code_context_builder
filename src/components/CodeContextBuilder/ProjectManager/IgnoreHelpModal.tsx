// src/components/CodeContextBuilder/ProjectManager/IgnoreHelpModal.tsx
import React, { useEffect } from 'react';

interface IgnoreHelpModalProps {
    isOpen: boolean;
    onClose: () => void;
}

const IgnoreHelpModal: React.FC<IgnoreHelpModalProps> = ({ isOpen, onClose }) => {
    useEffect(() => {
        if (!isOpen) return;

        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                onClose();
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => {
            window.removeEventListener('keydown', handleKeyDown);
        };
    }, [isOpen, onClose]);

    if (!isOpen) {
        return null;
    }

    // Using a similar structure to HotkeysModal CSS classes for consistency
    // but you can create specific ones if needed (.ignore-help-modal-overlay, etc.)
    return (
        <div className="hotkeys-modal-overlay" onClick={onClose}> {/* Re-use overlay style */}
            <div className="hotkeys-modal-content" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '700px' }}> {/* Re-use content style, adjust width */}
                <div className="hotkeys-modal-header"> {/* Re-use header style */}
                    <h4>Ignore Pattern Syntax Help</h4>
                    <button onClick={onClose}>Close (Esc)</button>
                </div>
                <div className="hotkeys-modal-body" style={{ fontSize: '0.95em' }}> {/* Re-use body style */}
                    <p>
                        Project-Specific Ignore Patterns supplement or override global defaults.
                        The system uses <strong>.gitignore</strong> syntax. Enter one pattern per line.
                        Global default patterns are applied first, then these project-specific patterns.
                    </p>

                    <h4>Syntax Basics</h4>
                    <ul>
                        <li>Lines starting with <code>#</code> are comments and are ignored.</li>
                        <li>Patterns are generally case-insensitive in this application.</li>
                        <li>Trailing spaces are ignored unless they are quoted.</li>
                    </ul>

                    <h4>Common Pattern Types</h4>
                    <ul>
                        <li>
                            <strong>Exact Match:</strong> <code>filename.ext</code>
                            <br />
                            <small>Matches files or directories named exactly 'filename.ext'.</small>
                        </li>
                        <li>
                            <strong>Directory Match:</strong> <code>build/</code> (note the trailing slash)
                            <br />
                            <small>Matches directories named 'build' anywhere in the project.</small>
                        </li>
                        <li>
                            <strong>Root-Anchored Directory:</strong> <code>/output/</code> (leading and trailing slash)
                            <br />
                            <small>Matches an 'output' directory ONLY at the project root.</small>
                        </li>
                        <li>
                            <strong>File Extension:</strong> <code>*.log</code>
                            <br />
                            <small>Matches any file ending with '.log' in any directory.</small>
                        </li>
                    </ul>

                    <h4>Wildcards</h4>
                    <ul>
                        <li>
                            <code>*</code> (Asterisk): Matches any sequence of characters except '/'.
                            <br />
                            <small>Example: <code>temp*</code> matches 'tempFile.txt', 'temporary_folder/'.</small>
                        </li>
                        <li>
                            <code>?</code> (Question Mark): Matches any single character except '/'.
                            <br />
                            <small>Example: <code>file?.txt</code> matches 'file1.txt', 'fileA.txt'.</small>
                        </li>
                        <li>
                            <code>**</code> (Globstar/Double Asterisk): Matches zero or more directories. Can be used to match patterns recursively.
                            <ul>
                                <li><code>**/tests/**</code>: Matches any file or directory under any directory named 'tests'.</li>
                                <li><code>src/**/*.js</code>: Matches all .js files within the 'src' directory and all its subdirectories.</li>
                            </ul>
                        </li>
                        <li>
                            <code>[...]</code> (Character Set): Matches any one character within the brackets.
                            <br />
                            <small>Example: <code>image[1-3].png</code> matches 'image1.png', 'image2.png', 'image3.png'.</small>
                        </li>
                    </ul>
                    
                    <h4>Substring Matching (using Wildcards)</h4>
                    <p>To match files or directories whose names contain a specific substring, combine wildcards:</p>
                    <ul>
                        <li><code>*substring*</code>: Matches if 'substring' appears anywhere in the name.
                            <br /><small>Example: <code>*report*</code> matches 'daily_report.pdf', 'report_data/'.</small>
                        </li>
                        <li><code>prefix*</code>: Matches names starting with 'prefix'.</li>
                        <li><code>*suffix</code>: Matches names ending with 'suffix'.</li>
                    </ul>

                    <h4>Negation (!)</h4>
                    <ul>
                        <li>A leading <code>!</code> negates a pattern, re-including files that were previously excluded.</li>
                        <li>This is crucial for overriding broader exclusion rules (from global defaults or earlier project patterns).</li>
                        <li>
                            <strong>Order Matters:</strong> The last matching pattern for a given file path determines its fate.
                            A negation rule must appear *after* the rule it intends to override, or after global defaults are conceptually applied.
                        </li>
                        <li>
                            Example:
                            <pre style={{ margin: '0.5em 0', padding: '0.5em', backgroundColor: 'var(--input-background-color)', borderRadius: '4px' }}>
                                <code>
                                    {`# Global default might ignore all logs:\n# *.log \n\n# Project-specific:\n*.log      # This project also ignores all .log files\n!debug.log # BUT, specifically keep 'debug.log'`}
                                </code>
                            </pre>
                        </li>
                         <li>
                            Another Example:
                            <pre style={{ margin: '0.5em 0', padding: '0.5em', backgroundColor: 'var(--input-background-color)', borderRadius: '4px' }}>
                                <code>
                                    {`# Global default might ignore 'dist/'\n\n# Project-specific:\ndist/*\n!dist/important_library.js`}
                                </code>
                            </pre>
                            <small>This attempts to ignore everything in 'dist' but keep 'important_library.js'.
                            Note: To exclude a directory but include specific files within it, you usually need to un-ignore the directory first if it was broadly ignored (e.g., `!dist/`), then re-ignore its contents (`dist/*`), then un-ignore the specific file (`!dist/important_file.js`). Simpler to just exclude specific sub-items if the directory itself isn't globally blacklisted.
                            </small>
                        </li>
                    </ul>
                    <p style={{marginTop: '1em', fontStyle: 'italic', fontSize: '0.9em'}}>
                        Refer to standard .gitignore documentation for more advanced patterns and nuances.
                    </p>
                </div>
            </div>
        </div>
    );
};

export default IgnoreHelpModal;