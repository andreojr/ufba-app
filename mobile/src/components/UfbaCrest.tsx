import type { JSX } from "react";
import Svg, { ClipPath, Defs, G, Path, Rect, Text as SvgText, Use } from "react-native-svg";

/** UFBA crest, used as a small trust mark ("Conectado ao SIGAA da UFBA"). */
export function UfbaCrest({ size = 22 }: { size?: number }): JSX.Element {
  return (
    <Svg width={size} height={size} viewBox="0 0 256 256" fill="none">
      <Defs>
        <Path
          id="flameOuter"
          d="M0 -44 C 9 -33 17 -25 17 -12 C 17 1 9 9 0 9 C -9 9 -17 1 -17 -12 C -17 -25 -9 -33 0 -44 Z"
        />
        <Path
          id="flameInner"
          d="M0 -28 C 5 -21 10 -16 10 -8 C 10 0 5 5 0 5 C -5 5 -10 0 -10 -8 C -10 -16 -5 -21 0 -28 Z"
        />
        <Path id="leaf" d="M0 0 C 5 -17 18 -30 42 -33 C 39 -12 25 1 7 4 C 2 4 0 2 0 0 Z" />
        <ClipPath id="shieldClip">
          <Path d="M60 92 C 82 86 174 86 196 92 L 196 150 C 196 180 166 194 128 202 C 90 194 60 180 60 150 Z" />
        </ClipPath>
      </Defs>

      <G stroke="#4A4238" strokeWidth={6} strokeLinecap="round" strokeLinejoin="round">
        <G fill="#D9C49C">
          <Rect x={72} y={84} width={13} height={164} rx={6} />
          <Rect x={121} y={84} width={13} height={164} rx={6} />
          <Rect x={170} y={84} width={13} height={164} rx={6} />
        </G>

        <G>
          <Use href="#flameOuter" x={78} y={58} fill="#F2A33C" />
          <Use href="#flameOuter" x={128} y={58} fill="#F2A33C" />
          <Use href="#flameOuter" x={178} y={58} fill="#F2A33C" />
          <G stroke="none" fill="#F7E6A6">
            <Use href="#flameInner" x={78} y={58} />
            <Use href="#flameInner" x={128} y={58} />
            <Use href="#flameInner" x={178} y={58} />
          </G>
        </G>

        <G fill="#D9C49C">
          <Rect x={63} y={58} width={30} height={20} rx={7} />
          <Rect x={113} y={58} width={30} height={20} rx={7} />
          <Rect x={163} y={58} width={30} height={20} rx={7} />
        </G>

        <Path
          fill="#2B3A8F"
          d="M60 92 C 82 86 174 86 196 92 L 196 150 C 196 180 166 194 128 202 C 90 194 60 180 60 150 Z"
        />

        <G clipPath="url(#shieldClip)" stroke="none" fill="#FFFFFF">
          <Path d="M96 188 C 118 164 140 142 164 112 L 172 118 C 148 148 124 170 104 194 Z" />
          <Use href="#leaf" transform="translate(164,116) rotate(-30)" />
          <Use href="#leaf" transform="translate(160,122) rotate(-95) scale(0.95)" />
          <Use href="#leaf" transform="translate(132,148) rotate(-120) scale(0.85)" />
          <Use href="#leaf" transform="translate(136,152) rotate(40) scale(0.8)" />
          <Use href="#leaf" transform="translate(106,176) rotate(-175) scale(0.75)" />
          <Use href="#leaf" transform="translate(110,180) rotate(70) scale(0.7)" />
        </G>

        <Path
          fill="#F4F2EC"
          d="M18 156 C 44 178 84 188 128 188 C 172 188 212 178 238 156 L 238 186 C 212 204 172 212 128 212 C 84 212 44 204 18 186 Z"
        />
        <Path fill="#2B3A8F" d="M26 180 C 92 196 164 196 230 180 L 230 208 C 164 224 92 224 26 208 Z" />
        <Path
          fill="#2B3A8F"
          d="M90 222 C 114 229 142 229 166 222 L 166 242 C 142 249 114 249 90 242 Z"
        />
      </G>

      {/* Plain (uncurved) text, not <TextPath> — the curve was subtle enough not to
          be missed, and textPath centering (startOffset + textAnchor) turned out to
          be unreliable across renderers: react-native-svg on-device truncated the
          motto mid-word ("VIRTUTE SP…"), and librsvg (used to rasterize the app
          icon) didn't render textPath text at all. Plain text has neither problem. */}
      <SvgText
        x={128}
        y={208}
        fill="#FFFFFF"
        fontSize={20}
        fontFamily="Georgia, 'Times New Roman', serif"
        letterSpacing={0.6}
        textAnchor="middle"
      >
        VIRTUTE SPIRITUS
      </SvgText>
      <SvgText
        x={128}
        y={241}
        fill="#FFFFFF"
        fontSize={15}
        fontFamily="Georgia, 'Times New Roman', serif"
        textAnchor="middle"
      >
        1808
      </SvgText>
    </Svg>
  );
}
