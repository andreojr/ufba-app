import { Typography, useThemeColor } from "heroui-native";
import type { JSX } from "react";
import { Pressable, View } from "react-native";

import { AppIcon } from "@/components/AppIcon";
import { iniciais } from "@/lib/iniciais";
import { formatTempoLecionando } from "@/lib/tempo-lecionando";
import type { DocenteResumo, DocenteSelos } from "@/lib/types";

/**
 * What the badges are for: in the measured sample most public profiles are
 * nearly empty, so a card that looks tappable but leads to a blank page is the
 * failure mode to design out. The badges say what is actually behind the tap,
 * and a docente with no public record at all does not navigate.
 *
 * `semestresLecionando` renders separately from the rest (see the caller) —
 * it is the one badge with a number worth setting in mono, the others are
 * plain words.
 */
function rotulosDosSelos(selos: DocenteSelos): string[] {
  const rotulos: string[] = [];
  if (selos.contato) rotulos.push("Contato");
  if (selos.formacao) rotulos.push("Formação");
  if (selos.areasInteresse) rotulos.push("Áreas");
  if (selos.lattes) rotulos.push("Lattes");
  if (selos.orientacoes) rotulos.push("Orientações");
  return rotulos;
}

export function DocenteCard({
  resumo,
  onPress,
}: {
  resumo: DocenteResumo;
  onPress: (siape: string) => void;
}): JSX.Element {
  const mutedColor = useThemeColor("muted");
  const perfil = resumo.perfil;
  const desabilitado = perfil === null;
  const nome = perfil?.nome ?? resumo.nomeOriginal;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: desabilitado }}
      disabled={desabilitado}
      onPress={() => {
        if (perfil) onPress(perfil.siape);
      }}
      style={{ opacity: desabilitado ? 0.55 : 1 }}
      className="mb-3 rounded-3xl bg-surface-secondary p-4"
    >
      <View className="flex-row items-center gap-3">
        <View
          className={`h-11 w-11 items-center justify-center rounded-2xl ${
            desabilitado ? "bg-muted/20" : "bg-accent-soft"
          }`}
        >
          <Typography.Paragraph
            type="body-sm"
            weight="semibold"
            className={desabilitado ? undefined : "text-accent-soft-foreground"}
          >
            {iniciais(nome)}
          </Typography.Paragraph>
        </View>
        <View className="flex-1">
          <Typography.Paragraph type="body-sm" numberOfLines={1}>
            {nome}
          </Typography.Paragraph>
          {perfil?.departamento ? (
            <Typography.Paragraph type="body-xs" color="muted" numberOfLines={1}>
              {perfil.departamento}
            </Typography.Paragraph>
          ) : null}
        </View>
        {desabilitado ? null : (
          <AppIcon name="IconCaretRight" size={18} color={mutedColor} />
        )}
      </View>

      <View className="mt-3 flex-row flex-wrap gap-1.5">
        {resumo.componentes.map((componente) => (
          <View key={componente.codigo} className="rounded-xl bg-accent-soft px-2 py-1">
            <Typography.Paragraph type="body-xs" weight="medium" className="text-accent-soft-foreground">
              {componente.codigo}
            </Typography.Paragraph>
          </View>
        ))}
      </View>

      {desabilitado ? (
        <Typography.Paragraph type="body-xs" color="muted" className="mt-3">
          Perfil não disponível no SIGAA
        </Typography.Paragraph>
      ) : (
        <View className="mt-3 flex-row items-center justify-between gap-2">
          {rotulosDosSelos(perfil.selos).length > 0 ? (
            <Typography.Paragraph type="body-xs" color="muted" className="flex-1">
              {rotulosDosSelos(perfil.selos).join(" · ")}
            </Typography.Paragraph>
          ) : (
            <View className="flex-1" />
          )}
          {perfil.selos.semestresLecionando > 0 ? (
            // Same color and size as the badges to its left — the time-taught
            // metric is one more fact about the docente, not a call to
            // action, so it does not earn the accent color. Bottom-right
            // corner keeps it out of the way of the badge list, which can
            // wrap to more than one line.
            <View className="flex-row items-center gap-1">
              <AppIcon name="IconClock" size={12} color={mutedColor} />
              <Typography.Paragraph type="body-xs" color="muted">
                {formatTempoLecionando(perfil.selos.semestresLecionando)}
              </Typography.Paragraph>
            </View>
          ) : null}
        </View>
      )}
    </Pressable>
  );
}
