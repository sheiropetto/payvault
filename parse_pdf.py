import re
import pypdf
import pandas as pd

PURPOSE_KEYWORDS = [
    "PAYMENT", "PYMT", "PETTY CASH", "PETTYCASH", "SALARY", "CLAIM", "RENTAL", 
    "INSTALLMENT", "EXPENSES", "ALLOWANCE", "CERT", "FEE", "COURSE", "SERVICE", 
    "DOWNPYMT", "PARKING", "CHECK SOLAR", "BIL TM", "INSOLVENSI", "ELAUN", 
    "CLEANER", "MONTLY", "TENDER", "AUDIT", "ROADTAX", "INSURANCE", "PRINT", 
    "COMPANY", "PROFILE", "SABAH", "TIKET", "GALA", "DINNER", "SPAN", "HSE", 
    "LOAN", "SCORE", "PRINTER", "IMIGRESEN", "MASSIVE", "OFFICE", "CYBER", 
    "TNB", "INDAH WATER", "IWK", "PETTY", "CASH", "BIL", "CTC", "AZ", "FOR", 
    "ICE", "NATHAN", "TRANSFER", "FUND", "JAN", "FEB", "MAR", "APR", "MAY", 
    "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC", "JAN24", "JANUARY", 
    "FEBRUARY", "MARCH", "APRIL", "JUNE", "JULY", "AUGUST", "SEPTEMBER", 
    "OCTOBER", "NOVEMBER", "DECEMBER", "DUIT RAYA", "DUITRAYA"
]

purpose_pattern = re.compile(r'\s+\b(' + '|'.join(PURPOSE_KEYWORDS) + r')\b.*', re.IGNORECASE)

def clean_extracted_name(name):
    # Strip common system identifiers / references
    name = re.sub(r'MYCN\d+.*', '', name, flags=re.IGNORECASE)
    name = re.sub(r'DUITNOW\s*\(.*', '', name, flags=re.IGNORECASE)
    name = re.sub(r'Balance\s+C/F.*', '', name, flags=re.IGNORECASE)
    
    # Strip purpose and trailing text
    name = purpose_pattern.sub('', name)
    
    # Strip any alphanumeric reference codes (must contain BOTH letters and digits, and be length >= 5)
    name = re.sub(r'\s+\b(?=[A-Z]*\d)(?=\d*[A-Z])[A-Z0-9_-]{5,}\b.*$', '', name, flags=re.IGNORECASE)
    
    # Clean up double spaces
    name = re.sub(r'\s+', ' ', name).strip()
    
    # Apply name mappings/corrections for truncated payees
    mappings = {
        'MUHAMMAD RAIMIEY BIN': 'MUHAMMAD RAIMIEY',
        'FARZIEYANA BINTI MOH': 'FARZIEYANA BINTI MOHD ARIFF',
        'SITI MARDIANASARI BI': 'SITI MARDIANASARI',
        'AILYN BINTI ABD.MAJI': 'AILYN BINTI ABD MAJID'
    }
    upper_name = name.upper()
    if upper_name in mappings:
        return mappings[upper_name]
        
    return name

def extract_payee(desc):
    if not desc:
        return ""
    
    du = desc.upper()
    
    known_entities = {
        'LEMBAGA HASIL DALAM NEGERI': 'LEMBAGA HASIL DALAM NEGERI',
        'KUMPULAN WANG SIMPANAN PEKERJA': 'KUMPULAN WANG SIMPANAN PEKERJA',
        'PERTUBUHAN KESELAMATAN SOSIAL': 'PERTUBUHAN KESELAMATAN SOSIAL',
        'LEMBAGA PEMBANGUNAN INDUSTRI': 'LEMBAGA PEMBANGUNAN INDUSTRI',
    }
    
    for key, val in known_entities.items():
        if key in du:
            return val
            
    # DR-ECP / DEP-ECP
    if 'DR-ECP' in du:
        m = re.search(r'DR-ECP\s+\d+(?:\s+\d+)?\s*(.*)', du)
        if m:
            return clean_extracted_name(m.group(1))
    if 'DEP-ECP' in du:
        m = re.search(r'DEP-ECP\s+\d+\s*(.*)', du)
        if m:
            name = m.group(1)
            name = re.sub(r'^[A-Z0-9]{15,}\s+', '', name)
            name = re.sub(r'^(RHB|MBB|PBB|CIMB)\s+', '', name, flags=re.IGNORECASE)
            return clean_extracted_name(name)

    # DUITNOW TRSF DR/CR
    m = re.search(r'DUITNOW\s+TRSF\s+(?:DR|CR)\s+(?:\d{6}\s+)?(.*)', du)
    if m:
        return clean_extracted_name(m.group(1))
        
    # TSFR FUND DR/CR-ATM/EFT
    m = re.search(r'TSFR\s+FUND\s+(?:DR|CR)(?:-ATM/EFT)?\s+\d{6}\s+(?:\w*X{2,}\w*\s+)?(.*)', du)
    if m:
        name = m.group(1)
        name = re.sub(r'^(IBG|SCB|CGB|WARRANT|TRANSFER|EFT)\s+', '', name, flags=re.IGNORECASE)
        return clean_extracted_name(name)
        
    # GIRO PYMT-ATM/EFT
    m = re.search(r'GIRO\s+PYMT-ATM/EFT\s+\d*\s*(.*)', du)
    if m:
        name = m.group(1)
        if 'JOMPAY' in name:
            return ''
        return clean_extracted_name(name)

    # RMT CR → KENANGA INVESTMENT BANK
    if 'RMT CR' in du:
        return 'KENANGA INVESTMENT BANK BERHAD'
    if any(x in du for x in ['RMT DR', 'RMT CHRG']):
        return ''
    if 'AUTOMATED LOAN' in du:
        return ''
    if re.search(r'\bCH(E)?Q(UE)?\s+PROCESS\s+FEE\b', du):
        return ''
    if re.match(r'^CHEQ\s+\d+', du):
        return ''
    if 'MISC DR' in du:
        return ''
    if 'DEP-CASH' in du:
        return ''
    if 'FPX' in du:
        return ''

    # Fallback to clean fallback name
    cleaned = du
    prefixes = [
        r'\b(TSFR|FUND|CR|DR|DUITNOW|TRSF|GIRO|PYMT|FPX|DEP-CASH|CDT|IBG|ATM|CASH)\b',
        r'\b(ATM-EFT|PROCESS|FEE|LEMBAGA|HASIL|DALAM|NEGERI)\b',
        r'\d{5,}',
        r'[^A-Z0-9\s.\-/&]'
    ]
    for pattern in prefixes:
        cleaned = re.sub(pattern, ' ', cleaned)
    return clean_extracted_name(cleaned)

def parse_public_bank_statement(pdf_path):
    reader = pypdf.PdfReader(pdf_path)
    
    # Combine all pages into one text stream
    full_text = ""
    for page in reader.pages:
        full_text += page.extract_text() + "\n"
    
    lines = full_text.split('\n')
    
    # Pattern: [DD/MM] AMOUNT BALANCE [DESCRIPTION]
    tx_start = re.compile(
        r'^(\d{2}/\d{2})\s+'           # Group 1: date DD/MM
        r'([\d,]+\.\d{2})\s+'          # Group 2: amount
        r'([\d,]+\.\d{2})'             # Group 3: balance (no space before desc!)
        r'(.*)$'                        # Group 4: description (rest of line)
    )
    
    # Also match lines without date (continuation or date-less)
    tx_cont = re.compile(
        r'^([\d,]+\.\d{2})\s+'          # Group 1: amount
        r'([\d,]+\.\d{2})'             # Group 2: balance
        r'(.*)$'                        # Group 3: description
    )
    
    transactions = []
    current_date = None
    inside_transactions = True
    
    for line in lines:
        line = line.strip()
        if not line:
            continue
        
        line_upper = line.upper()
        
        # State machine check: are we crossing page boundaries/headers/footers?
        if any(marker in line_upper for marker in ['BALANCE C/F', 'BAKI HANTAR HADAPAN', 'CLOSING BALANCE', 'BAKI AKHIR PENYATA', 'DAILY AND CLOSING BALANCES']):
            inside_transactions = False
            continue
            
        if any(marker in line_upper for marker in ['BALANCE B/F', 'BAKI BAWA HADAPAN']):
            inside_transactions = True
            continue
        
        # Try date+amount+balance+desc pattern
        m = tx_start.match(line)
        if m:
            inside_transactions = True
            current_date = m.group(1)
            amount = float(m.group(2).replace(',', ''))
            balance = float(m.group(3).replace(',', ''))
            desc = m.group(4).strip()
            if desc and len(desc) > 2:
                transactions.append({
                    'date': current_date,
                    'amount': amount,
                    'balance': balance,
                    'desc': desc,
                    'cont_lines': []
                })
            continue
        
        # Try amount+balance+desc pattern (no date, on same day)
        m2 = tx_cont.match(line)
        if m2 and current_date:
            inside_transactions = True
            amount = float(m2.group(1).replace(',', ''))
            balance = float(m2.group(2).replace(',', ''))
            desc = m2.group(3).strip()
            
            # Skip summary/header lines that happen to match
            if desc and len(desc) > 2 and not desc.startswith('Balance'):
                # Check if this is a continuation of previous transaction's desc
                tx_codes = ['TSFR', 'DUITNOW', 'GIRO', 'DR-ECP', 'DEP-ECP', 'CHEQ', 'CHQ',
                           'LOAN', 'AUTOMATED', 'FPX', 'IBG', 'ATM', 'DEP-CASH', 'RMT', 'MISC']
                is_new_tx = any(code in desc.upper() for code in tx_codes)
                
                if is_new_tx:
                    transactions.append({
                        'date': current_date,
                        'amount': amount,
                        'balance': balance,
                        'desc': desc,
                        'cont_lines': []
                    })
                elif transactions:
                    # Continuation line for previous transaction
                    transactions[-1]['cont_lines'].append(desc)
            continue
            
        # If we are not inside transactions (e.g. footers, headers), skip all other text lines
        if not inside_transactions:
            continue
            
        # Skip other known header/footer/metadata lines even if inside_transactions is True
        if any(kw in line_upper for kw in [
            'PENYATA AKAUN', 'TARIKH URUS', 'DATE TRANSACTION',
            'MUKA SURAT', 'PAGE ', 'TERIMA KASIH', 'TEGASAN',
            'RAZ UTAMA SDN BHD', 'KL CITY MAIN OFFICE', 'GRD FLOOR MENARA PUBLIC BANK',
            '146 JLN AMPANG', '50450 KUALA LUMPUR', 'TEL: 03-21767888',
            'DILINDUNGI OLEH PIDM', 'PROTECTED BY PIDM',
            'NOMBOR AKAUN', 'ACCOUNT NUMBER',
            'TARIKH PENYATA', 'STATEMENT DATE',
            'TERIMA KASIH KERANA BERURUS NIAGA', 'THANK YOU FOR BANKING',
            'KECEMERLANGAN ADALAH ILTIZAM KAMI', 'EXCELLENCE IS OUR COMMITMENT',
            'KEMUSYKILAN ANDA MENGENAI', 'YOUR BANKING QUESTIONS ANSWERED',
            'ANDA BOLEH MELIHAT NOTIS PRIVASI', 'YOU MAY VIEW PUBLIC BANK\'S PRIVACY NOTICE',
            'PERHATIAN / ATTENTION', 'ANTI-RASUAH DAN ANTI-SOGOKAN', 'ANTI-BRIBERY AND ANTI-CORRUPTION POLICY'
        ]):
            continue
            
        if transactions and len(line) > 2 and not re.match(r'^[\d,]+\.\d{2}', line):
            transactions[-1]['cont_lines'].append(line)
    
    # Build final records
    records = []
    prev_balance = None
    
    for tx in transactions:
        full_desc = tx['desc']
        for cl in tx['cont_lines']:
            full_desc += ' ' + cl
        
        # Determine debit/credit using balance chain
        if prev_balance is not None:
            delta = tx['balance'] - prev_balance
            if delta < -0.005:
                dr, cr = abs(delta), 0.0
            elif delta > 0.005:
                dr, cr = 0.0, delta
            else:
                desc_up = full_desc.upper()
                if any(kw in desc_up for kw in ['CR', 'CDT', 'DEP-']):
                    dr, cr = 0.0, tx['amount']
                else:
                    dr, cr = tx['amount'], 0.0
        else:
            desc_up = full_desc.upper()
            if any(kw in desc_up for kw in ['CR', 'CDT', 'DEP-']):
                dr, cr = 0.0, tx['amount']
            else:
                dr, cr = tx['amount'], 0.0
        
        if dr + cr < 0.005:
            continue
        
        records.append({
            'Date': tx['date'],
            'Description': full_desc[:150],
            'Payee': extract_payee(full_desc),
            'Withdrawal (DR)': round(dr, 2),
            'Deposit (CR)': round(cr, 2),
            'Balance': tx['balance']
        })
        
        prev_balance = tx['balance']
    
    df = pd.DataFrame(records)
    return df


if __name__ == '__main__':
    import sys
    if len(sys.argv) < 2:
        pdf_file = "Sample/2024/3226704211_2024-October.pdf"
    else:
        pdf_file = sys.argv[1]
        
    try:
        df_statement = parse_public_bank_statement(pdf_file)
        csv_name = pdf_file.rsplit('.', 1)[0] + '_parsed.csv'
        df_statement.to_csv(csv_name, index=False)
        print(f"Successfully extracted {len(df_statement)} transactions and saved to {csv_name}.")
        print(df_statement.head(30).to_string())
        print(f"\n--- Totals ---")
        dr = df_statement["Withdrawal (DR)"].sum()
        cr = df_statement["Deposit (CR)"].sum()
        print(f"Total DR: {dr:,.2f}")
        print(f"Total CR: {cr:,.2f}")
        dr_count = (df_statement["Withdrawal (DR)"] > 0).sum()
        cr_count = (df_statement["Deposit (CR)"] > 0).sum()
        print(f"DR count: {dr_count}, CR count: {cr_count}")
    except Exception as e:
        import traceback
        traceback.print_exc()
