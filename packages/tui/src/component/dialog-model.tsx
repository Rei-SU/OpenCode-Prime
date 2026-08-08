import { createMemo, createSignal, For, Show } from "solid-js"
import { useLocal } from "../context/local"
import { map, pipe, flatMap, entries, filter, sortBy, take } from "remeda"
import { DialogSelect } from "../ui/dialog-select"
import { useDialog } from "../ui/dialog"
import { createDialogProviderOptions, DialogProvider } from "./dialog-provider"
import { DialogVariant } from "./dialog-variant"
import * as fuzzysort from "fuzzysort"
import { useConnected } from "./use-connected"
import { useSync } from "../context/sync"
import { useTheme, selectedForeground } from "../context/theme"
import { useBindings } from "../keymap"
import { RGBA } from "@opentui/core"
import { useTerminalDimensions } from "@opentui/solid"

export function DialogModel(props: { providerID?: string }) {
  const local = useLocal()
  const sync = useSync()
  const dialog = useDialog()
  const { theme } = useTheme()
  const [query, setQuery] = createSignal("")
  const [providerFilter, setProviderFilter] = createSignal<string>()

  const connected = useConnected()
  const providers = createDialogProviderOptions()

  const showExtra = createMemo(() => connected() && !props.providerID)

  const filterProviders = createMemo(() =>
    pipe(
      sync.data.provider,
      sortBy((provider) => provider.id !== "opencode", (provider) => provider.name),
      map((provider) => provider.id),
    ),
  )

  function providerName(id: string | undefined) {
    if (id === undefined) return "ALL"
    return sync.data.provider.find((provider) => provider.id === id)?.name ?? id
  }

  const options = createMemo(() => {
    const needle = query().trim()
    const showSections = showExtra() && needle.length === 0
    const favorites = connected() ? local.model.favorite() : []
    const recents = local.model.recent()
    const selectedProvider = providerFilter()

    function withinProvider(item: { providerID: string; modelID: string }) {
      return selectedProvider === undefined || item.providerID === selectedProvider
    }

    function toOptions(items: typeof favorites, category: string) {
      if (!showSections) return []
      return items.flatMap((item) => {
        const provider = sync.data.provider.find((provider) => provider.id === item.providerID)
        if (!provider) return []
        const model = provider.models[item.modelID]
        if (!model) return []
        if (!withinProvider(item)) return []
        return [
          {
            key: item,
            value: { providerID: provider.id, modelID: model.id },
            title: model.name ?? item.modelID,
            description: provider.name,
            category,
            disabled: provider.id === "opencode" && model.id.includes("-nano"),
            footer: model.cost?.input === 0 && provider.id === "opencode" ? "Free" : undefined,
            onSelect: () => {
              onSelect(provider.id, model.id)
            },
          },
        ]
      })
    }

    const favoriteOptions = toOptions(favorites, "Favorites")
    const recentOptions = toOptions(
      recents.filter(
        (item) =>
          !favorites.some((fav) => fav.providerID === item.providerID && fav.modelID === item.modelID) &&
          withinProvider(item),
      ),
      "Recent",
    )

    const providerOptions = pipe(
      sync.data.provider,
      filter((provider) => selectedProvider === undefined || provider.id === selectedProvider),
      sortBy(
        (provider) => provider.id !== "opencode",
        (provider) => provider.name,
      ),
      flatMap((provider) =>
        pipe(
          provider.models,
          entries(),
          filter(([_, info]) => info.status !== "deprecated"),
          filter(([_, info]) => (props.providerID ? info.providerID === props.providerID : true)),
          map(([model, info]) => ({
            value: { providerID: provider.id, modelID: model },
            title: info.name ?? model,
            releaseDate: info.release_date,
            description: favorites.some((item) => item.providerID === provider.id && item.modelID === model)
              ? "(Favorite)"
              : undefined,
            category: connected() ? provider.name : undefined,
            disabled: provider.id === "opencode" && model.includes("-nano"),
            footer: info.cost?.input === 0 && provider.id === "opencode" ? "Free" : undefined,
            onSelect() {
              onSelect(provider.id, model)
            },
          })),
          filter((option) => {
            if (!showSections) return true
            if (
              favorites.some(
                (item) => item.providerID === option.value.providerID && item.modelID === option.value.modelID,
              )
            )
              return false
            if (
              recents.some(
                (item) => item.providerID === option.value.providerID && item.modelID === option.value.modelID,
              )
            )
              return false
            return true
          }),
          (options) => sortModelOptions(options, props.providerID !== undefined),
        ),
      ),
    )

    const popularProviders = !connected()
      ? pipe(
          providers(),
          map((option) => ({
            ...option,
            category: "Popular providers",
          })),
          take(6),
        )
      : []

    if (needle) {
      return [
        ...sortModelOptions(
          fuzzysort.go(needle, providerOptions, { keys: ["title", "category"] }).map((x) => x.obj),
          false,
        ),
        ...fuzzysort.go(needle, popularProviders, { keys: ["title"] }).map((x) => x.obj),
      ]
    }

    return [...favoriteOptions, ...recentOptions, ...providerOptions, ...popularProviders]
  })

  useBindings(() => ({
    bindings: [
      {
        key: "ctrl+left",
        desc: "Previous provider filter",
        group: "Dialog",
        cmd: () => cycleProviderFilter(-1),
      },
      {
        key: "ctrl+right",
        desc: "Next provider filter",
        group: "Dialog",
        cmd: () => cycleProviderFilter(1),
      },
    ],
  }))

  function cycleProviderFilter(direction: number) {
    const ids = [undefined, ...filterProviders()]
    if (ids.length === 1) return
    const index = ids.indexOf(providerFilter())
    const next = (index + direction + ids.length) % ids.length
    setProviderFilter(ids[next])
  }

  // Sliding navbar-style carousel: every provider chip is rendered with its full
  // name inside a clipped viewport, and the track slides left so the active
  // provider anchors at the viewport's left edge. Overflowing names are clipped,
  // not truncated, and scroll into view as the user cycles. The slide is clamped
  // so the tail of the list never slides past the viewport's right edge, which
  // would leave an empty gap once the last provider is fully visible.
  const carouselIds = createMemo(() => [undefined, ...filterProviders()])

  const dimensions = useTerminalDimensions()

  const viewportWidth = createMemo(() => {
    const dialogWidth = Math.min(60, dimensions().width - 2)
    const usable = dialogWidth - 8
    const arrows = 6
    return Math.max(0, usable - arrows)
  })

  const totalTrackWidth = createMemo(() => {
    const ids = carouselIds()
    return ids.reduce((sum, id) => sum + providerName(id).length + 2, 0) + (ids.length - 1)
  })

  const slideOffset = createMemo(() => {
    const ids = carouselIds()
    const active = ids.indexOf(providerFilter())
    if (active <= 0) return 0
    let offset = 0
    for (let i = 0; i < active; i++) {
      offset += providerName(ids[i]).length + 3
    }
    const maxOffset = Math.max(0, totalTrackWidth() - viewportWidth())
    return Math.min(offset, maxOffset)
  })

  const provider = createMemo(() =>
    props.providerID ? sync.data.provider.find((item) => item.id === props.providerID) : null,
  )

  const title = createMemo(() => {
    const value = provider()
    if (!value) return "Select model"
    return value.name
  })

  function onSelect(providerID: string, modelID: string) {
    local.model.set({ providerID, modelID }, { recent: true })
    const list = local.model.variant.list()
    const cur = local.model.variant.selected()
    if (cur === "default" || (cur && list.includes(cur))) {
      dialog.clear()
      return
    }
    if (list.length > 0) {
      dialog.replace(() => <DialogVariant />)
      return
    }
    dialog.clear()
  }

  return (
    <DialogSelect<ReturnType<typeof options>[number]["value"]>
      options={options()}
      header={
        <Show when={showExtra() && filterProviders().length > 1}>
          <box flexDirection="row" justifyContent="space-between">
            <box
              backgroundColor={RGBA.fromInts(0, 0, 0, 0)}
              onMouseUp={() => cycleProviderFilter(-1)}
              paddingLeft={1}
              paddingRight={1}
              flexShrink={0}
            >
              <text fg={theme.textMuted}>◀</text>
            </box>
            <box flexDirection="row" flexShrink={1} flexGrow={1} overflow="hidden">
              <box
                flexDirection="row"
                gap={1}
                flexShrink={0}
                marginLeft={-slideOffset()}
              >
                <For each={carouselIds()}>
                  {(item) => {
                    const active = () => item === providerFilter()
                    return (
                      <box
                        backgroundColor={active() ? theme.primary : RGBA.fromInts(0, 0, 0, 0)}
                        onMouseUp={() => setProviderFilter(item)}
                        paddingLeft={1}
                        paddingRight={1}
                        flexShrink={0}
                      >
                        <text fg={active() ? selectedForeground(theme) : theme.textMuted} wrapMode="none">
                          {providerName(item)}
                        </text>
                      </box>
                    )
                  }}
                </For>
              </box>
            </box>
            <box
              backgroundColor={RGBA.fromInts(0, 0, 0, 0)}
              onMouseUp={() => cycleProviderFilter(1)}
              paddingLeft={1}
              paddingRight={1}
              flexShrink={0}
            >
              <text fg={theme.textMuted}>▶</text>
            </box>
          </box>
        </Show>
      }
      actions={[
        {
          command: "model.dialog.provider",
          title: connected() ? "Connect provider" : "View all providers",
          onTrigger() {
            dialog.replace(() => <DialogProvider />)
          },
        },
        {
          command: "model.dialog.favorite",
          title: "Favorite",
          hidden: !connected(),
          onTrigger: (option) => {
            local.model.toggleFavorite(option.value as { providerID: string; modelID: string })
          },
        },
      ]}
      footerHints={
        showExtra() && filterProviders().length > 1
          ? [{ title: "Filter provider", label: "ctrl+←/→", side: "right" }]
          : undefined
      }
      onFilter={setQuery}
      flat={true}
      skipFilter={true}
      title={title()}
      current={local.model.current()}
    />
  )
}

export function sortModelOptions<T extends { footer?: string; releaseDate: string | number; title: string }>(
  options: T[],
  newestFirst: boolean,
) {
  if (newestFirst) return sortBy(options, [(option) => option.releaseDate, "desc"], (option) => option.title)
  return sortBy(
    options,
    (option) => option.footer !== "Free",
    [(option) => option.releaseDate, "desc"],
    (option) => option.title,
  )
}
