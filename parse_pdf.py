import re
import pypdf
import pandas as pd

def parse_public_bank_statement(pdf_path):
    reader = pypdf.PdfReader(pdf_path)
    
    # Combine all pages into one text stream
    full_text = ""
    for page in reader.pages:
        full_text += page.extract_text() + "\n"
    
    lines = full_text.split('\n')
    
    # Pattern: [DD/MM] AMOUNT BALANCE [DESCRIPTION]
    # pypdf concatenates balance+desc without space, so we use regex to split
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
    
    for line in lines:
        line = line.strip()
        if not line:
            continue
        
        # Skip header/footer lines
        if any(kw in line for kw in ['PENYATA AKAUN', 'TARIKH URUS', 'DATE TRANSACTION',
                                       'Muka Surat', 'Page ', 'TERIMA KASIH', 'TEGASAN']):
            continue
        
        # Try date+amount+balance+desc pattern
        m = tx_start.match(line)
        if m:
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
            amount = float(m2.group(1).replace(',', ''))
            balance = float(m2.group(2).replace(',', ''))
            desc = m2.group(3).strip()
            
            # Skip summary/header lines that happen to match
            if desc and len(desc) > 2 and not desc.startswith('Balance'):
                # Check if this is a continuation of previous transaction's desc
                # (no TX code) or a new transaction
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
                # Balance unchanged - check description
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
            'Withdrawal (DR)': round(dr, 2),
            'Deposit (CR)': round(cr, 2),
            'Balance': tx['balance']
        })
        
        prev_balance = tx['balance']
    
    df = pd.DataFrame(records)
    return df


pdf_file = "Sample/3226704211_2024-October.pdf"
try:
    df_statement = parse_public_bank_statement(pdf_file)
    print(f"Successfully extracted {len(df_statement)} transactions.")
    df_statement.to_csv("Sample/october_pypdf_parsed.csv", index=False)
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
