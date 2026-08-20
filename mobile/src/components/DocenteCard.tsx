import { Chip, Typography, useThemeColor } from "heroui-native";
import type { JSX } from "react";
import { Pressable, View } from "react-native";

import { AppIcon } from "@/components/AppIcon";
import type { DocenteResumo, DocenteSelos } from "@/lib/types";

function iniciais(nome: string): string {
  const partes = nome.trim().split(/\s+/).filter(Boolean);
  if (partes.length === 0) return "?";
  const primeira = partes[0][0] ?? "";
  const ultima = partes.length > 1 ? (partes[partes.length - 1][0] ?? "") : "";
  return (primeira + ultima).toUpperCase();
}

/**
 * What the badges are for: in the measured sample most public profiles are
 * nearly empty, so a card that looks tappable but leads to a blank page is the
 * failure mode to design out. The badges say what is actually behind the tap,
 * and a docente with no public record at all does not navigate.
 */
function rotulosDosSelos(selos: DocenteSelos): string[] {
  const rotulos: string[] = [];
  if (selos.contato) rotulos.push("Contato");
  if (selos.formacao) rotulos.push("Formação");
  if (selos.areasInteresse) rotulos.push("Áreas");
  if (selos.lattes) rotulos.push("Lattes");
  if (selos.orientacoes) rotulos.push("Orientações");
  if (selos.semestresLecionando > 0) {
    rotulos.push(
      selos.semestresLecionando === 1 ? "1 semestre" : `${selos.semestresLecionando} semestres`,
    );
  }
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
      className="mb-3 rounded-2xl border border-border p-4"
    >
      <View className="flex-row items-center gap-3">
        <View className="h-11 w-11 items-center justify-center rounded-full bg-muted/20">
          <Typography.Paragraph type="body-sm">{iniciais(nome)}</Typography.Paragraph>
        </View>
        <View className="flex-1">
          <Typography.Paragraph type="body-sm" numberOfLines={2}>
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
          <Chip key={componente.codigo} variant="soft" size="sm">
            {componente.codigo}
          </Chip>
        ))}
      </View>

      {desabilitado ? (
        <Typography.Paragraph type="body-xs" color="muted" className="mt-3">
          Perfil não disponível no SIGAA
        </Typography.Paragraph>
      ) : (
        <View className="mt-3 flex-row flex-wrap gap-x-3 gap-y-1">
          {rotulosDosSelos(perfil.selos).map((rotulo) => (
            <Typography.Paragraph key={rotulo} type="body-xs" color="muted">
              {rotulo}
            </Typography.Paragraph>
          ))}
        </View>
      )}
    </Pressable>
  );
}
