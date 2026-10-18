import React, { useEffect, useState } from 'react';
import { Image, StyleSheet, View } from 'react-native';
import type { Cover, Genre } from '../features/types';
import { color as c, font, genreColor, radius } from '../theme/tokens';
import { slipFontSize, slipText } from '../utils/format';
import { Txt } from './Text';

export interface BookCoverProps {
  title: string | null;
  genre: Genre | null;
  cover?: Cover;
  width: number;
  /** Cache key for image covers: the file name never changes, so pass updatedAt (S03 §5). */
  version?: string;
}

const SPINE = 8;

/**
 * Text book cover (UI §4.7, §8.2): 3:4, genre colour, radius 3, a vertical title
 * slip at the top left and an 8 pt spine with 4 binding stitches on the right.
 * Vertical text is one character per line (RN has no writing-mode). Image covers
 * hide the slip and keep the spine; if the image fails, the text cover is shown.
 */
export function BookCover({ title, genre, cover, width, version }: BookCoverProps) {
  const height = Math.round((width * 4) / 3);
  const [imageFailed, setImageFailed] = useState(false);
  const imagePath = cover?.kind === 'image' ? cover.path : undefined;
  useEffect(() => { setImageFailed(false); }, [imagePath, version]);
  const showImage = cover?.kind === 'image' && !imageFailed;
  const chars = slipText(title);
  const shown = chars ?? Array.from('未命名');
  const size = Math.max(10, Math.round(slipFontSize(shown.length, height) * (width >= 90 ? 1 : width / 90)));
  const small = width < 60;

  return (
    <View
      style={[styles.cover, { width, height, backgroundColor: genreColor(genre) }]}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      {showImage ? (
        <Image
          source={{ uri: `${cover.path.startsWith('/') ? 'file://' : ''}${cover.path}${version ? `?v=${encodeURIComponent(version)}` : ''}` }}
          style={StyleSheet.absoluteFill}
          resizeMode="cover"
          onError={() => setImageFailed(true)}
        />
      ) : small ? null : (
        <View style={[styles.slip, { top: height * 0.08, left: width * 0.12, paddingHorizontal: size * 0.3 }]}>
          {shown.map((ch, i) => (
            <Txt
              key={i}
              allowFontScaling={false}
              style={{
                fontFamily: font.serif,
                fontSize: size,
                lineHeight: Math.round(size * 1.2),
                color: chars ? c.ink : c.ink3,
              }}
              align="center"
            >
              {ch}
            </Txt>
          ))}
        </View>
      )}
      <View style={styles.spine}>
        {[0, 1, 2, 3].map(i => (
          <View key={i} style={[styles.stitch, { top: `${12 + i * 25}%` }]} />
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  cover: { borderRadius: radius.cover, overflow: 'hidden' },
  slip: {
    position: 'absolute',
    backgroundColor: c.slip,
    paddingVertical: 6,
    alignItems: 'center',
    borderRadius: 1,
  },
  spine: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    right: 0,
    width: SPINE,
    backgroundColor: 'rgba(0,0,0,0.28)',
  },
  stitch: { position: 'absolute', left: 1, right: 1, height: 1, backgroundColor: 'rgba(255,255,255,0.45)' },
});
