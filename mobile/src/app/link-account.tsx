import { useRouter } from "expo-router";
import { cpf as cpfValidator } from "cpf-cnpj-validator";
import {
  Button,
  FieldError,
  Input,
  Label,
  Spinner,
  TextField,
  Typography,
  useThemeColor,
  useToast,
} from "heroui-native";
import { useState, type JSX } from "react";
import { Linking, Pressable, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useCSSVariable } from "uniwind";

import { AppBar } from "@/components/AppBar";
import { AppIcon } from "@/components/AppIcon";
import { describeApiError } from "@/lib/api-errors";
import { useSigaaLink } from "@/lib/sigaa-link-context";
import { dangerToast } from "@/lib/toast-helpers";

// "000.000.000-00" — the longest a masked CPF can ever get, used as the
// Input's native maxLength so the 12th digit never flashes on screen before
// formatCpf() truncates it on the next render.
const CPF_MASKED_MAX_LENGTH = 14;

// Escrito para quem não entende de tecnologia: sem jargão, uma frase por
// dúvida concreta de quem está prestes a digitar a senha. Uma frase, não duas
// — o texto longo aqui tem o efeito contrário do pretendido: quem desconfia
// não lê seis parágrafos, e quem lê acha que tanta explicação esconde algo.
// Onde ficam guardada e quem consegue ver eram a mesma resposta em dois
// bullets, e o login em segundo plano era o caso particular de "quem entra é
// o celular".
const PASSWORD_PRIVACY_POINTS = [
  "Fica no cofre do aparelho, junto das suas outras senhas.",
  "Não sobe para nenhum servidor: ninguém além de você consegue vê-la.",
  "Quem entra no sistema da faculdade é sempre o seu celular, até nas buscas automáticas.",
  "Desinstalou o aplicativo? A senha vai embora com ele.",
];

// A outra metade da promessa: a senha é o que não sobe, e estes são os dados
// que sobem. O histórico escolar que o app lê traz CPF, RG e data de
// nascimento no cabeçalho, então dizer só "sua senha está segura" deixaria a
// dúvida maior sem resposta. Vinha do Perfil, onde aparecia uma única vez,
// antes do primeiro sync; aqui fica colado nos outros checks e sempre
// visível, porque é aqui que a pessoa decide entregar o acesso.
const SERVER_DATA_POINTS: { label: string; text: string }[] = [
  { label: "O que fica guardado:", text: "suas matérias, notas e carga horária." },
  {
    label: "O que não fica:",
    text: "CPF, RG e data de nascimento, descartados na leitura do histórico.",
  },
  // Veio do card da senha, que não era o lugar: apagar é sobre o que está no
  // servidor, e é justamente este o card que diz o que está lá.
  { label: "Se mudar de ideia:", text: "apaga tudo com um toque, em Perfil." },
];

// Duas razões para o código estar aberto, na ordem em que importam para quem
// está nesta tela: primeiro a que responde à desconfiança, depois a que
// convida a participar.
const OPEN_SOURCE_POINTS = [
  "Não precisa acreditar só no que está escrito: qualquer pessoa pode ler o que o código faz.",
  "Achou um problema, ou tem uma ideia para o aplicativo? Você pode contribuir com o projeto.",
];

// TODO: repositório ainda não publicado — trocar pela URL real antes de
// mandar o app para as lojas, senão o card leva a um 404 e faz o efeito
// contrário do que promete.
const REPO_URL = "https://github.com/gradline-app/gradline";

function formatCpf(raw: string): string {
  const digits = raw.replace(/\D/g, "").slice(0, 11);
  let out = digits.slice(0, 3);
  if (digits.length > 3) out += "." + digits.slice(3, 6);
  if (digits.length > 6) out += "." + digits.slice(6, 9);
  if (digits.length > 9) out += "-" + digits.slice(9, 11);
  return out;
}

export default function LinkAccountScreen(): JSX.Element {
  const router = useRouter();
  const sigaaLink = useSigaaLink();
  const { toast } = useToast();
  const isLinked = sigaaLink.status === "linked";
  const senhaDesatualizada = sigaaLink.status === "linked" && sigaaLink.senhaDesatualizada;
  const [cpf, setCpf] = useState("");
  const [senha, setSenha] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [
    accentSoftForeground,
    successSoftForeground,
    dangerSoftForeground,
    dangerForeground,
    foregroundColor,
  ] = useThemeColor([
    "accent-soft-foreground",
    "success-soft-foreground",
    "danger-soft-foreground",
    "danger-foreground",
    "foreground",
  ]);
  const insets = useSafeAreaInsets();
  // Not a HeroUI semantic token (useThemeColor only knows its fixed list), so this
  // one's read straight off the CSS custom property registered in global.css.
  const accentShadeRaw = useCSSVariable("--color-accent-shade");
  const accentShade = typeof accentShadeRaw === "string" ? accentShadeRaw : undefined;

  const cpfDigits = cpf.replace(/\D/g, "");
  const isCpfComplete = cpfDigits.length === 11;
  const isCpfInvalid = isCpfComplete && !cpfValidator.isValid(cpf);
  const canSubmit = isCpfComplete && !isCpfInvalid && senha.length > 0 && !isSubmitting;

  async function handleSubmit(): Promise<void> {
    if (!canSubmit) {
      return;
    }

    setIsSubmitting(true);
    try {
      // SIGAA at UFBA authenticates by CPF — this IS the `login` value the
      // backend's SigaaLinkDto expects, sent unformatted (digits only).
      // Sempre "device": a senha nunca é guardada na nuvem — quando o app
      // precisa buscar algo em segundo plano, o backend só dá um toque neste
      // celular, e é ele que faz a requisição ao SIGAA com a senha local.
      await sigaaLink.link(cpfDigits, senha, "device");
      router.replace("/(tabs)");
    } catch (error) {
      console.warn("SIGAA link failed", error);
      toast.show(
        dangerToast({
          // The password came from the field right above this toast.
          label: describeApiError(error, { passwordJustTyped: true }),
          icon: <AppIcon name="IconErrorCircle" size={20} color={dangerForeground} />,
        })
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleUnlink(): Promise<void> {
    await sigaaLink.unlink();
  }

  return (
    <View className="flex-1 bg-background">
      {/* Chegando pelo Perfil (ou por qualquer tela que empilhou esta), a seta
          devolve o usuário de onde ele veio. No primeiro acesso a tela é a raiz
          da pilha — não há para onde voltar, e a seta não aparece. */}
      <AppBar
        title="Conta Acadêmica"
        onBack={router.canGoBack?.() ? () => router.back() : undefined}
      />
      <ScrollView
        className="flex-1 px-6"
        contentContainerClassName="gap-4 pt-2 pb-4"
        showsVerticalScrollIndicator={false}
      >
        {senhaDesatualizada ? (
          // O usuário chega aqui pelo X vermelho no Perfil, ou depois de um
          // toast de "Credenciais inválidas" — em nenhum dos dois casos ele
          // sabe necessariamente *por que*. Esta é a explicação.
          <View
            testID="senha-desatualizada-aviso"
            className="flex-row items-center gap-3 rounded-3xl bg-danger-soft px-4 py-3.5"
          >
            <AppIcon name="IconErrorCircle" size={24} color={dangerSoftForeground} />
            <View className="flex-1 gap-0.5">
              <Typography.Paragraph weight="medium">Sua senha do SIGAA mudou</Typography.Paragraph>
              <Typography.Paragraph type="body-xs" color="muted">
                Digite a senha nova para o aplicativo voltar a buscar suas informações.
              </Typography.Paragraph>
            </View>
          </View>
        ) : isLinked ? (
          <View className="flex-row items-center gap-3 rounded-3xl bg-success-soft px-4 py-3.5">
            <AppIcon name="IconCheckCircle" size={24} color={successSoftForeground} />
            <View className="flex-1 gap-0.5">
              <Typography.Paragraph weight="medium">Conta vinculada</Typography.Paragraph>
              <Typography.Paragraph type="body-xs" color="muted">
                A senha fica guardada só neste aparelho
              </Typography.Paragraph>
            </View>
          </View>
        ) : null}

        <Typography.Paragraph color="muted">
          Entre com os mesmos dados que você usa no sistema da faculdade. O aplicativo usa isso
          só para buscar suas informações.
        </Typography.Paragraph>

        <TextField isRequired isInvalid={isCpfInvalid}>
          <Label>CPF</Label>
          <Input
            placeholder="000.000.000-00"
            keyboardType="number-pad"
            maxLength={CPF_MASKED_MAX_LENGTH}
            value={cpf}
            onChangeText={(value) => setCpf(formatCpf(value))}
          />
          {isCpfInvalid ? <FieldError>CPF inválido</FieldError> : null}
        </TextField>

        <View className="gap-2">
          <TextField isRequired>
            <Label>Senha do SIGAA</Label>
            <View className="w-full flex-row items-center">
              <Input
                className="flex-1"
                placeholder="Sua senha do sistema"
                secureTextEntry={!showPassword}
                value={senha}
                onChangeText={setSenha}
              />
            </View>
          </TextField>
          <Pressable
            className="flex-row items-center gap-1.5 self-start"
            onPress={() => setShowPassword((v) => !v)}
          >
            <AppIcon name={showPassword ? "IconEyeSlash" : "IconEye"} size={16} color={accentSoftForeground} />
            <Typography.Paragraph type="body-xs" className="text-accent">
              {showPassword ? "Esconder senha" : "Mostrar senha"}
            </Typography.Paragraph>
          </Pressable>
        </View>

        {/* Dois assuntos — a senha que não sai, os dados que saem — como dois
            cards unidos pelo fio de `gap-0.5` e pelos cantos internos moles,
            do mesmo jeito que o Perfil junta o card do aluno ao acadêmico. */}
        <View className="gap-0.5">
          <View
            testID="password-stays-on-device"
            className="gap-3 rounded-t-3xl rounded-b-md bg-success-soft p-4"
          >
            <View className="flex-row items-center gap-2.5">
              <AppIcon name="IconLockKey" size={24} color={successSoftForeground} />
              <Typography.Paragraph weight="medium" className="flex-1">
                Sua senha nunca sai deste celular
              </Typography.Paragraph>
            </View>
            {PASSWORD_PRIVACY_POINTS.map((point) => (
              <View key={point} className="flex-row gap-2.5">
                <AppIcon name="IconCheck" size={16} color={successSoftForeground} />
                <Typography.Paragraph type="body-xs" className="flex-1">
                  {point}
                </Typography.Paragraph>
              </View>
            ))}
          </View>

          <View
            testID="server-data-card"
            className="gap-3 rounded-t-md rounded-b-3xl bg-success-soft p-4"
          >
            <View className="flex-row items-center gap-2.5">
              <AppIcon name="IconIdentificationCard" size={24} color={successSoftForeground} />
              <Typography.Paragraph weight="medium" className="flex-1">
                No servidor fica só o que é da faculdade
              </Typography.Paragraph>
            </View>
            {SERVER_DATA_POINTS.map((point) => (
              <View key={point.label} className="flex-row gap-2.5">
                <AppIcon name="IconCheck" size={16} color={successSoftForeground} />
                <Typography.Paragraph type="body-xs" className="flex-1">
                  <Typography.Paragraph type="body-xs" weight="medium">
                    {point.label}{" "}
                  </Typography.Paragraph>
                  {point.text}
                </Typography.Paragraph>
              </View>
            ))}
          </View>
        </View>

        {/* O card acima é uma promessa, e uma promessa vale o quanto se
            confia em quem promete. Este é o card que dispensa a confiança:
            o código está aberto, dá para ir ler a linha que descarta o CPF.
            Fora do card verde de propósito — não é mais uma garantia nossa,
            é o convite a conferir as anteriores. */}
        <Pressable
          testID="open-source-card"
          className="flex-row items-start gap-3.5 rounded-3xl bg-surface-secondary p-4 active:opacity-70"
          onPress={() => void Linking.openURL(REPO_URL)}
        >
          <AppIcon name="IconGithubLogo" size={26} color={foregroundColor} />
          <View className="flex-1 gap-1">
            <Typography.Paragraph weight="medium">Código aberto</Typography.Paragraph>
            {OPEN_SOURCE_POINTS.map((point) => (
              <View key={point} className="flex-row gap-2">
                {/* Marcador desenhado, e não um "•" de texto: o caractere
                    herda a entrelinha do parágrafo e desalinha na quebra de
                    linha. O `mt` é o que apoia o ponto na primeira linha. */}
                <View className="w-1 h-1 mt-2 rounded-full bg-muted/60" />
                <Typography.Paragraph type="body-xs" color="muted" className="flex-1">
                  {point}
                </Typography.Paragraph>
              </View>
            ))}
            <View className="flex-row items-center gap-1.5 pt-1">
              <Typography.Paragraph type="body-xs" weight="medium" className="text-accent">
                Ver o código no GitHub
              </Typography.Paragraph>
              <AppIcon name="IconArrowSquareOut" size={13} color={accentSoftForeground} />
            </View>
          </View>
        </Pressable>
      </ScrollView>

      <View
        className="gap-2.5 px-6 pt-3.5 bg-background"
        style={{ paddingBottom: insets.bottom + 24 }}
      >
        {isSubmitting ? (
          <View className="h-14 rounded-full bg-accent-soft flex-row items-center justify-center gap-2.5">
            <Spinner />
            <Typography.Paragraph className="text-accent" weight="medium">
              Conferindo no SIGAA…
            </Typography.Paragraph>
          </View>
        ) : (
          <Button
            testID="link-submit-button"
            size="lg"
            className="w-full flex-row gap-2"
            isDisabled={!canSubmit}
            onPress={handleSubmit}
          >
            <AppIcon name="IconArrowsClockwise" size={20} color={accentShade} />
            <Button.Label>{isLinked ? "Salvar alterações" : "Vincular conta"}</Button.Label>
          </Button>
        )}
        {isLinked ? (
          <Button
            testID="link-unlink-button"
            variant="danger-soft"
            className="w-full"
            onPress={handleUnlink}
          >
            Desvincular conta
          </Button>
        ) : null}
      </View>
    </View>
  );
}
