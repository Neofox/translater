import { ListenPlaceholder } from './ResultPlaceholders'

export default function AlternativeItemSkeleton() {
  return (
    <li className="alternative-item alternative-skeleton" aria-hidden>
      <div className="alternative-actions inline-flex items-center">
        <ListenPlaceholder />
        <ListenPlaceholder />
      </div>
      <p className="alternative-text">
        <span className="animate-pulse" />
      </p>
      <p className="alternative-note">
        <span className="animate-pulse" />
      </p>
    </li>
  )
}
