"use client"

import { useState, useTransition, type DragEvent } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { CalendarClock } from "lucide-react"
import { toast } from "sonner"

import { formatTHB, formatTHBWhole } from "@/lib/money"
import type { DealStage } from "@/lib/metrics/pipeline"
import { Card, CardContent } from "@/components/ui/card"
import { cn } from "@/lib/utils"
import { updateDealStage } from "../actions"

export type BoardColumn = { stage: DealStage; label: string }

export type BoardDeal = {
  id: string
  title: string
  stage: DealStage
  client: string
  valueSatang: number
  followUp: string | null
}

// Custom MIME type so the board ignores unrelated drags (files, text, links).
const DEAL_MIME = "application/x-bbn-deal-id"

export function DealsBoard({
  columns,
  deals,
  today,
}: {
  columns: BoardColumn[]
  deals: BoardDeal[]
  today: string
}) {
  const router = useRouter()
  const [, startTransition] = useTransition()

  // Local copy for optimistic moves; re-sync whenever the server sends fresh props.
  const [items, setItems] = useState(deals)
  const [prevDeals, setPrevDeals] = useState(deals)
  if (deals !== prevDeals) {
    setPrevDeals(deals)
    setItems(deals)
  }

  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [overStage, setOverStage] = useState<DealStage | null>(null)

  function moveDeal(id: string, stage: DealStage) {
    const deal = items.find((d) => d.id === id)
    if (!deal || deal.stage === stage) return
    const from = deal.stage
    const label = columns.find((c) => c.stage === stage)?.label ?? stage

    setItems((prev) => prev.map((d) => (d.id === id ? { ...d, stage } : d)))
    startTransition(async () => {
      const res = await updateDealStage(id, stage)
      if (res?.error) {
        setItems((prev) =>
          prev.map((d) => (d.id === id ? { ...d, stage: from } : d))
        )
        toast.error(res.error)
        return
      }
      toast.success(`Moved "${deal.title}" to ${label}`)
      router.refresh()
    })
  }

  function onDragOver(e: DragEvent<HTMLDivElement>, stage: DealStage) {
    if (!e.dataTransfer.types.includes(DEAL_MIME)) return
    e.preventDefault()
    e.dataTransfer.dropEffect = "move"
    if (overStage !== stage) setOverStage(stage)
  }

  function onDragLeave(e: DragEvent<HTMLDivElement>) {
    // Ignore leave events fired when moving between children of the column.
    if (e.currentTarget.contains(e.relatedTarget as Node | null)) return
    setOverStage(null)
  }

  function onDrop(e: DragEvent<HTMLDivElement>, stage: DealStage) {
    const id = e.dataTransfer.getData(DEAL_MIME)
    setOverStage(null)
    setDraggingId(null)
    if (!id) return
    e.preventDefault()
    moveDeal(id, stage)
  }

  return (
    <div className="-mx-4 overflow-x-auto px-4 pb-2 md:-mx-6 md:px-6">
      <div className="flex min-w-max gap-4">
        {columns.map((col) => {
          const colDeals = items.filter((d) => d.stage === col.stage)
          const colTotal = colDeals.reduce((acc, d) => acc + d.valueSatang, 0)
          const isOver = overStage === col.stage
          return (
            <div key={col.stage} className="w-72 shrink-0">
              <div className="mb-2 flex items-center justify-between px-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold">{col.label}</span>
                  <span className="text-muted-foreground text-xs">
                    {colDeals.length}
                  </span>
                </div>
                <span className="text-muted-foreground text-xs">
                  {formatTHBWhole(colTotal)}
                </span>
              </div>
              <div
                data-stage={col.stage}
                onDragOver={(e) => onDragOver(e, col.stage)}
                onDragLeave={onDragLeave}
                onDrop={(e) => onDrop(e, col.stage)}
                className={cn(
                  "min-h-24 space-y-2 rounded-lg bg-muted/40 p-2 ring-2 ring-transparent transition-colors",
                  isOver && "bg-primary/5 ring-primary/40"
                )}
              >
                {colDeals.length === 0 ? (
                  <p className="text-muted-foreground px-2 py-6 text-center text-xs">
                    {isOver ? "Drop here" : "No deals"}
                  </p>
                ) : (
                  colDeals.map((d) => (
                    <DealCard
                      key={d.id}
                      deal={d}
                      today={today}
                      dragging={draggingId === d.id}
                      onDragStart={(e) => {
                        e.dataTransfer.setData(DEAL_MIME, d.id)
                        e.dataTransfer.effectAllowed = "move"
                        setDraggingId(d.id)
                      }}
                      onDragEnd={() => {
                        setDraggingId(null)
                        setOverStage(null)
                      }}
                    />
                  ))
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function DealCard({
  deal,
  today,
  dragging,
  onDragStart,
  onDragEnd,
}: {
  deal: BoardDeal
  today: string
  dragging: boolean
  onDragStart: (e: DragEvent<HTMLDivElement>) => void
  onDragEnd: () => void
}) {
  const { id, title, client, valueSatang, followUp } = deal
  const overdue = followUp != null && followUp < today
  const dueToday = followUp === today

  return (
    <div
      draggable
      data-deal-id={id}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      className={cn(
        "cursor-grab active:cursor-grabbing",
        dragging && "opacity-40"
      )}
    >
      <Card className="gap-0 py-0 transition-colors hover:border-ring">
        <CardContent className="p-3">
          <Link
            href={`/deals/${id}`}
            draggable={false}
            className="block space-y-1.5"
          >
            <div className="text-sm font-medium leading-snug">{title}</div>
            <div className="text-muted-foreground text-xs">{client}</div>
            <div className="flex items-center justify-between gap-2 pt-0.5">
              <span className="text-sm font-semibold">
                {formatTHB(valueSatang)}
              </span>
              {followUp ? (
                <span
                  className={cn(
                    "inline-flex items-center gap-1 text-xs",
                    overdue
                      ? "font-medium text-red-600 dark:text-red-400"
                      : dueToday
                        ? "font-medium text-amber-600 dark:text-amber-400"
                        : "text-muted-foreground"
                  )}
                >
                  <CalendarClock className="size-3" />
                  {followUp}
                </span>
              ) : null}
            </div>
          </Link>
        </CardContent>
      </Card>
    </div>
  )
}
