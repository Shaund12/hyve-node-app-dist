import React from 'react';
import {View} from 'react-native';
import Svg, {Polyline, Defs, LinearGradient, Stop, Rect} from 'react-native-svg';

interface Props {
  data: number[];
  width?: number;
  height?: number;
  color?: string;
  filled?: boolean;
}

export function Sparkline({data, width = 120, height = 40, color = '#58a6ff', filled = true}: Props) {
  if (!data || data.length < 2) {
    return <View style={{width, height}} />;
  }

  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const padding = 2;
  const w = width - padding * 2;
  const h = height - padding * 2;

  const points = data
    .map((v, i) => {
      const x = padding + (i / (data.length - 1)) * w;
      const y = padding + h - ((v - min) / range) * h;
      return `${x},${y}`;
    })
    .join(' ');

  // Build a closed path for fill area
  const fillPoints = `${padding},${height - padding} ${points} ${width - padding},${height - padding}`;

  return (
    <Svg width={width} height={height}>
      <Defs>
        <LinearGradient id={`grad-${color.replace('#', '')}`} x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor={color} stopOpacity="0.3" />
          <Stop offset="1" stopColor={color} stopOpacity="0" />
        </LinearGradient>
      </Defs>
      {filled && (
        <Polyline
          points={fillPoints}
          fill={`url(#grad-${color.replace('#', '')})`}
          stroke="none"
        />
      )}
      <Polyline
        points={points}
        fill="none"
        stroke={color}
        strokeWidth={1.5}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </Svg>
  );
}
