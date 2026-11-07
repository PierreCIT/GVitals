// Keep theme sizing when the setting is zero, without losing threshold colors.
export function valueStyle(colorStyle, size) {
    const color = colorStyle || '';
    return size > 0 ? `${color} font-size: ${size}px;`.trim() : color;
}
