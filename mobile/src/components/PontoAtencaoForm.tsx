import { Button, FieldError, Input, Label, TextField, Typography, useThemeColor } from "heroui-native";
import { useState, type JSX } from "react";
import { Pressable, View } from "react-native";

import { AppIcon, type AppIconName } from "@/components/AppIcon";
import { describeApiError } from "@/lib/api-errors";
import { dataIsoLocal } from "@/lib/pontos-atencao";
import type { EntradaPonto, TipoPonto, Turma } from "@/lib/types";

const ICONE_TIPO: Record<TipoPonto, AppIconName> = {
  PROVA: "IconFlag",
  TRABALHO: "IconFileText",
};

const ROTULO_TIPO: Record<TipoPonto, string> = {
  PROVA: "Prova",
  TRABALHO: "Trabalho",
};

/**
 * Mantém só os dígitos e reinsere as barras nas posições certas — funciona
 * tanto para quem digita "22092026" quanto para quem cola "22/09/2026"
 * pronto (o `replace` descarta as barras já existentes antes de reformatar).
 */
function maskData(bruto: string): string {
  const digitos = bruto.replace(/\D/g, "").slice(0, 8);
  let saida = digitos.slice(0, 2);
  if (digitos.length > 2) saida += "/" + digitos.slice(2, 4);
  if (digitos.length > 4) saida += "/" + digitos.slice(4, 8);
  return saida;
}

function maskHora(bruto: string): string {
  const digitos = bruto.replace(/\D/g, "").slice(0, 4);
  let saida = digitos.slice(0, 2);
  if (digitos.length > 2) saida += ":" + digitos.slice(2, 4);
  return saida;
}

/**
 * "dd/mm/aaaa" -> "YYYY-MM-DD", ou null se a data não parsear ou não existir
 * no calendário (ex: "31/02/2026" vira 3 de março pro `Date`, e essa
 * reconstrução dos componentes não bate mais com o que foi digitado).
 */
function converterDataParaIso(texto: string): string | null {
  const partes = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(texto);
  if (!partes) return null;
  const [, diaStr, mesStr, anoStr] = partes;
  const dia = Number(diaStr);
  const mes = Number(mesStr);
  const ano = Number(anoStr);
  const data = new Date(ano, mes - 1, dia);
  if (data.getFullYear() !== ano || data.getMonth() !== mes - 1 || data.getDate() !== dia) {
    return null;
  }
  return dataIsoLocal(data);
}

function formatarDataParaMascara(dataIso: string): string {
  const [ano, mes, dia] = dataIso.split("-");
  return `${dia}/${mes}/${ano}`;
}

/** HH:MM com hora 00-23 e minuto 00-59 — o que o backend de fato aceita. A
 * máscara sozinha deixa passar "1" (400 opaco no envio) e "99:99" (aceito e
 * gravado, ordenando pro fim do dia). */
const HORA_VALIDA = /^([01]\d|2[0-3]):[0-5]\d$/;

export interface PontoAtencaoFormValorInicial {
  tipo: TipoPonto;
  titulo: string;
  /** YYYY-MM-DD — convertido pro campo mascarado dd/mm/aaaa na montagem. */
  data: string;
  hora: string | null;
  observacao: string | null;
}

interface PontoAtencaoFormProps {
  /** Turma fixa (veio da rota, ou é a do item em edição) — some com o seletor. */
  turmaId?: string;
  /** Turmas do semestre pra montar o seletor quando `turmaId` não veio. */
  turmas: Turma[];
  valorInicial?: PontoAtencaoFormValorInicial;
  salvarRotulo?: string;
  onSalvar: (turmaId: string, entrada: EntradaPonto) => Promise<void>;
  podeApagar?: boolean;
  onApagar?: () => void;
}

/**
 * Corpo do formulário de cadastro/edição de ponto de atenção, compartilhado
 * pelas rotas `novo` e `[id]` (ver Task 12) — elas só decidem de onde vêm os
 * valores iniciais e o que fazer com o resultado.
 */
export function PontoAtencaoForm({
  turmaId,
  turmas,
  valorInicial,
  salvarRotulo = "Salvar",
  onSalvar,
  podeApagar = false,
  onApagar,
}: PontoAtencaoFormProps): JSX.Element {
  const [tipo, setTipo] = useState<TipoPonto>(valorInicial?.tipo ?? "PROVA");
  const [titulo, setTitulo] = useState(valorInicial?.titulo ?? "");
  const [dataTexto, setDataTexto] = useState(
    valorInicial ? formatarDataParaMascara(valorInicial.data) : "",
  );
  const [horaTexto, setHoraTexto] = useState(valorInicial?.hora ?? "");
  const [observacao, setObservacao] = useState(valorInicial?.observacao ?? "");
  // Deliberadamente sem seleção inicial: pré-marcar a primeira turma faria
  // um aluno que não reparar registrar o prazo contra a matéria errada — o
  // que aparece nas home screens dos colegas errados. Ver Task 12, fix 1.
  const [turmaSelecionada, setTurmaSelecionada] = useState<string | undefined>(undefined);
  const [erroTitulo, setErroTitulo] = useState(false);
  const [erroData, setErroData] = useState(false);
  const [erroHora, setErroHora] = useState(false);
  const [erroTurma, setErroTurma] = useState(false);
  const [erroEnvio, setErroEnvio] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [accentForeground, mutedColor] = useThemeColor(["accent-foreground", "muted"]);

  const turmaEscolhida = turmaId ?? turmaSelecionada;
  // A regra de "não pode ser no passado" é só de criação: a lista mostra
  // vencidos de propósito, e um item CONTESTADO costuma estar contestado
  // exatamente porque a data já passou — bloquear a edição desses seria um
  // beco sem saída, inclusive pra corrigir um erro de digitação no título.
  const criando = valorInicial === undefined;

  async function salvar(): Promise<void> {
    const tituloLimpo = titulo.trim();
    const dataIso = converterDataParaIso(dataTexto);
    const hoje = dataIsoLocal(new Date());
    const tituloValido = tituloLimpo.length > 0;
    const dataValida = dataIso !== null && (!criando || dataIso >= hoje);
    const horaValida = horaTexto.length === 0 || HORA_VALIDA.test(horaTexto);

    const turmaValida = turmaEscolhida !== undefined;

    setErroTitulo(!tituloValido);
    setErroData(!dataValida);
    setErroHora(!horaValida);
    setErroTurma(!turmaValida);
    setErroEnvio(null);

    if (!tituloValido || !dataValida || !horaValida || !turmaValida || !turmaEscolhida || !dataIso) {
      return;
    }

    setSalvando(true);
    try {
      await onSalvar(turmaEscolhida, {
        tipo,
        titulo: tituloLimpo,
        data: dataIso,
        hora: horaTexto.length > 0 ? horaTexto : undefined,
        observacao: observacao.trim().length > 0 ? observacao.trim() : undefined,
      });
    } catch (error) {
      setErroEnvio(describeApiError(error));
    } finally {
      setSalvando(false);
    }
  }

  return (
    <View className="flex-1 gap-4 px-6 pt-2">
      {!turmaId ? (
        <View testID="seletor-turma" className="gap-2">
          <Typography.Paragraph type="body-sm" color="muted">
            Turma
          </Typography.Paragraph>
          {turmas.map((turma) => {
            const selecionada = turma.id === turmaSelecionada;
            return (
              <Pressable
                key={turma.id}
                testID={`turma-opcao-${turma.id}`}
                onPress={() => setTurmaSelecionada(turma.id)}
                className={`rounded-2xl px-4 py-3 ${
                  selecionada ? "bg-accent-soft border-2 border-accent" : "bg-surface-secondary"
                }`}
              >
                <Typography.Paragraph
                  weight="medium"
                  className={selecionada ? "text-accent" : undefined}
                >
                  {(turma.codigo ?? "—") + " · " + turma.nome}
                </Typography.Paragraph>
              </Pressable>
            );
          })}
          {erroTurma ? (
            <Typography.Paragraph testID="erro-turma" type="body-xs" className="text-danger">
              Escolha a turma
            </Typography.Paragraph>
          ) : null}
        </View>
      ) : null}

      <View className="gap-2">
        <Typography.Paragraph type="body-sm" color="muted">
          Tipo
        </Typography.Paragraph>
        <View className="flex-row gap-2.5">
          {(["PROVA", "TRABALHO"] as const).map((opcao) => {
            const selecionado = tipo === opcao;
            return (
              <Pressable
                key={opcao}
                testID={`tipo-${opcao}`}
                onPress={() => setTipo(opcao)}
                className={`flex-1 flex-row items-center justify-center gap-2 rounded-2xl py-3 ${
                  selecionado ? "bg-accent" : "bg-surface-secondary"
                }`}
              >
                <AppIcon
                  name={ICONE_TIPO[opcao]}
                  size={16}
                  color={selecionado ? accentForeground : mutedColor}
                />
                <Typography.Paragraph
                  type="body-sm"
                  weight="medium"
                  className={selecionado ? "text-white" : undefined}
                >
                  {ROTULO_TIPO[opcao]}
                </Typography.Paragraph>
              </Pressable>
            );
          })}
        </View>
      </View>

      <TextField isRequired isInvalid={erroTitulo}>
        <Label>Título</Label>
        <Input
          testID="campo-titulo"
          placeholder="Ex.: Avaliação I"
          value={titulo}
          onChangeText={setTitulo}
        />
        {erroTitulo ? <FieldError testID="erro-titulo">Informe um título</FieldError> : null}
      </TextField>

      <View className="flex-row gap-3">
        <TextField isRequired isInvalid={erroData} className="flex-1">
          <Label>Data</Label>
          <Input
            testID="campo-data"
            placeholder="dd/mm/aaaa"
            keyboardType="number-pad"
            maxLength={10}
            value={dataTexto}
            onChangeText={(texto) => setDataTexto(maskData(texto))}
          />
          {erroData ? (
            <FieldError testID="erro-data">
              {criando
                ? "Informe uma data válida, não anterior a hoje"
                : "Informe uma data válida"}
            </FieldError>
          ) : null}
        </TextField>

        <TextField isInvalid={erroHora} className="w-24">
          <Label>Hora</Label>
          <Input
            testID="campo-hora"
            placeholder="hh:mm"
            keyboardType="number-pad"
            maxLength={5}
            value={horaTexto}
            onChangeText={(texto) => setHoraTexto(maskHora(texto))}
          />
          {erroHora ? <FieldError testID="erro-hora">Informe uma hora válida</FieldError> : null}
        </TextField>
      </View>

      <TextField>
        <Label>Observação</Label>
        <Input
          testID="campo-observacao"
          placeholder="Opcional"
          value={observacao}
          onChangeText={setObservacao}
        />
      </TextField>

      {erroEnvio ? (
        <Typography.Paragraph testID="erro-envio" type="body-sm" className="text-danger">
          {erroEnvio}
        </Typography.Paragraph>
      ) : null}

      <View className="gap-2.5 pt-2">
        <Button testID="salvar-ponto" isDisabled={salvando} onPress={() => void salvar()}>
          {salvando ? "Salvando…" : salvarRotulo}
        </Button>
        {podeApagar && onApagar ? (
          <Button testID="apagar-ponto" variant="danger-soft" onPress={onApagar}>
            Apagar
          </Button>
        ) : null}
      </View>
    </View>
  );
}
