/**
 * 从 Notion page link 中提取 page ID
 * 支持格式：
 * - https://www.notion.so/5W2H-270baa810695804981e8e432c4fafe3a
 * - https://www.notion.so/5W2H-270baa810695804981e8e432c4fafe3a?source=copy_link
 * - 直接的 page ID: 270baa810695804981e8e432c4fafe3a
 * - 带连字符的 UUID 格式: 270baa81-0695-8049-81e8-e432c4fafe3a
 *
 * @param input - Notion URL 或 page ID
 * @returns 提取的 page ID (32位十六进制字符串)，如果解析失败则退出程序
 */
export function extractPageId(input: string): string {
    if (!input) {
        console.error('❌ 无效的输入：输入不能为空');
        process.exit(1);
    }

    const trimmedInput = input.trim();

    // 如果输入已经是一个 32 位的 page ID（去掉连字符后）
    const cleanInput = trimmedInput.replace(/-/g, '');
    if (/^[a-f0-9]{32}$/i.test(cleanInput)) {
        return cleanInput;
    }

    // 尝试从 URL 中提取 page ID
    let url: URL;
    try {
        url = new URL(trimmedInput);
    } catch (error) {
        // 不是有效的 URL，尝试作为纯 ID 处理
        if (error instanceof TypeError) {
            const directMatch = trimmedInput.match(/^([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})$/i);
            if (directMatch) {
                return directMatch[1].replace(/-/g, '');
            }
        }

        // 无法识别的格式
        console.error(`❌ 无效的 Notion page ID 或 URL 格式: ${trimmedInput}`);
        console.error('支持的格式：');
        console.error('  - Notion URL: https://www.notion.so/Title-270baa810695804981e8e432c4fafe3a');
        console.error('  - 32位十六进制: 270baa810695804981e8e432c4fafe3a');
        console.error('  - UUID格式: 270baa81-0695-8049-81e8-e432c4fafe3a');
        process.exit(1);
    }

    // URL 解析成功，从 pathname 中提取 page ID
    const pathname = url.pathname;

    // Notion URL 格式: /Title-{pageId} 或 /{pageId}
    // pageId 通常是最后一个连字符后的 32 位十六进制字符串
    const match = pathname.match(/([a-f0-9]{32})/i);
    if (match) {
        return match[1];
    }

    // 也支持带连字符的格式
    const matchWithDashes = pathname.match(/([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})/i);
    if (matchWithDashes) {
        return matchWithDashes[1].replace(/-/g, '');
    }

    // 如果是有效的 URL 但无法提取 page ID
    console.error(`❌ 无法从 URL 中提取有效的 Notion page ID: ${trimmedInput}`);
    console.error('支持的格式：');
    console.error('  - Notion URL: https://www.notion.so/Title-270baa810695804981e8e432c4fafe3a');
    console.error('  - 32位十六进制: 270baa810695804981e8e432c4fafe3a');
    console.error('  - UUID格式: 270baa81-0695-8049-81e8-e432c4fafe3a');
    process.exit(1);
}
