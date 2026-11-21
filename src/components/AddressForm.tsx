/**
 * AddressForm.tsx
 * The fields for one saved place. Used for a customer's delivery gate and a scribe's pickup address.
 */

export interface AddressFields {
  label: string
  college: string
  line: string
  landmark: string
  pincode: string
  contactName: string
  contactPhone: string
}

export const emptyAddress: AddressFields = { label: '', college: '', line: '', landmark: '', pincode: '', contactName: '', contactPhone: '' }

/** The form takes a 10-digit number; the API wants +91 in front. */
export const toApiAddress = (a: AddressFields) => ({
  ...a,
  landmark: a.landmark || undefined,
  contactPhone: `+91${a.contactPhone.replace(/\D/g, '').slice(-10)}`,
})

export default function AddressForm({
  value,
  onChange,
  lineLabel,
  idPrefix,
}: {
  value: AddressFields
  onChange: (next: AddressFields) => void
  lineLabel: string
  idPrefix: string
}) {
  const set = (key: keyof AddressFields) => (e: React.ChangeEvent<HTMLInputElement>) => onChange({ ...value, [key]: e.target.value })
  const field = (key: keyof AddressFields, label: string, extra: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <div className="field">
      <label htmlFor={`${idPrefix}-${key}`}>{label}</label>
      <input id={`${idPrefix}-${key}`} type="text" value={value[key]} onChange={set(key)} {...extra} />
    </div>
  )

  return (
    <div className="address-form">
      {field('college', 'College', { placeholder: 'e.g. Delhi Technological University' })}
      {field('line', lineLabel, { placeholder: 'e.g. Main Gate 2, or Hostel Block 4' })}
      {field('landmark', 'Landmark (optional)', { placeholder: 'e.g. Opposite the tea stall' })}
      <div className="address-row">
        {field('pincode', 'PIN code', { inputMode: 'numeric', maxLength: 6, placeholder: '110042' })}
        {field('label', 'Name for this place (optional)', { placeholder: 'e.g. Hostel gate' })}
      </div>
      <div className="address-row">
        {field('contactName', 'Person to hand over to', { placeholder: 'Name' })}
        {field('contactPhone', 'Their mobile number', { inputMode: 'numeric', maxLength: 10, placeholder: '10 digits' })}
      </div>
    </div>
  )
}
