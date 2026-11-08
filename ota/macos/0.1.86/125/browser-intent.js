// Completion planning only. This never grants permission or bypasses approval.
export function withoutExplicitProhibitions(text) {
    const ko = '(?:올리|올려|업로드|게시|배포|보내|공유|전송|등록|수정|편집|제작|생성|만들|바꾸)';
    const en = '(?:upload|post|publish|deploy|send|share|make|create|edit|redesign)';
    return text
        .replace(new RegExp(`(?:${ko}(?:하)?거나\\s*)*${ko}(?:하)?지\\s*(?:마(?:세요|십시오|라)?|말(?:고|아(?:주세요)?)?|않(?:아|고|도록|는다|습니다)?)`, 'g'), ' ')
        .replace(new RegExp(`${ko}\\s*(?:금지|하지\\s*않기)`, 'g'), ' ')
        .replace(new RegExp(`\\b(?:do\\s+not|don't|never)\\s+${en}(?:\\s+(?:or|and)\\s+${en})*\\b`, 'gi'), ' ');
}
