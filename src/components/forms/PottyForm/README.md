# PottyForm Component

A form component for creating and editing elimination-communication (potty) records for a baby. This component follows the form-page pattern used throughout the application.

## Features

- Create new potty records
- Edit existing potty records
- Support for different catch types (Pee, Poop, Both)
- Receptacle ("Where") picker with an inline manager for hiding locations a family doesn't use
- Optional notes
- Form validation for required fields
- Responsive design

## Props

| Prop | Type | Required | Description |
|------|------|----------|-------------|
| `isOpen` | boolean | Yes | Controls whether the form is visible |
| `onClose` | () => void | Yes | Function to call when the form should be closed |
| `babyId` | string \| undefined | Yes | ID of the baby for whom the potty visit is being recorded |
| `initialTime` | string | Yes | Initial time value for the form (ISO format) |
| `activity` | PottyLogResponse | No | Existing potty record data (for edit mode) |
| `onSuccess` | () => void | No | Optional callback function called after successful submission |

## Usage

```tsx
import PottyForm from '@/src/components/forms/PottyForm';

function MyComponent() {
  const [showPottyForm, setShowPottyForm] = useState(false);
  const [selectedBaby, setSelectedBaby] = useState<{ id: string }>();

  return (
    <>
      <Button onClick={() => setShowPottyForm(true)}>
        Log Potty
      </Button>

      <PottyForm
        isOpen={showPottyForm}
        onClose={() => setShowPottyForm(false)}
        babyId={selectedBaby?.id}
        initialTime={new Date().toISOString()}
        onSuccess={() => {
          // Refresh data or perform other actions after successful submission
        }}
      />
    </>
  );
}
```

## Form Fields

- **Time**: Date and time of the potty visit (required)
- **Type**: Pee, Poop, or Both (required)
- **Where**: The receptacle used (Potty Chair, Toilet, Sink, Tub, Outside, Other) (optional)
- **Notes**: Free-text notes (optional)

## Implementation Details

- Uses the `FormPage` component for consistent UI across the application
- Implements `useEffect` hooks to populate form data when editing
- Uses an `isInitialized` flag so a reopened form does not clobber in-progress edits or reset when `initialTime` changes
- Provides validation before submission
- Handles API calls (`POST`/`PUT /api/potty-log`) for creating and updating potty records
- Surfaces the account-expiration flow via `handleExpirationError` on 403 responses

### Type reuses `DiaperType`

`PottyLog.type` reuses the same `DiaperType` enum (`WET` / `DIRTY` / `BOTH`) that `DiaperLog` uses, so no new enum was added to the schema. The form only relabels the values for the potty context: `WET` → "Pee", `DIRTY` → "Poop", `BOTH` → "Pee and Poop".

### Receptacle visibility is managed in-form

Unlike most settings, which live in `SettingsForm`, hidden receptacles are managed directly inside `PottyForm` — mirroring `SleepForm`'s hidden-location pattern rather than `DiaperForm`. A gear icon next to the "Where" label reveals a checklist of all `POTTY_LOCATIONS`; toggling one calls `POST /api/potty-location-settings` with the updated `hiddenLocations` list, and the picker itself filters out hidden locations via `visibleLocations`. A location that's hidden is still shown when editing a record that already uses it, so hiding a receptacle never makes an existing record uneditable.
